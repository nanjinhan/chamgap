"""WiFi MQTT 링크 (2단계, 지시서 4.4). 메시지 내용은 시리얼과 완전히 같다 (SYS-03).

- chamgap/+/+ 를 구독한다. cmd 토픽(우리가 보낸 것)은 무시한다.
- online 토픽(retained, 1/0)은 {"t":"online","node":X,"online":0|1} 줄로 바꿔 넘긴다.
- paho의 loop_start() 스레드에서 받은 줄은 hub가 이벤트 루프로 넘긴다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from .base import LineCallback, Link, StatusCallback

log = logging.getLogger("chamgap.mqtt")

SRC = "mqtt"
TOPIC_ROOT = "chamgap"
MSG_KINDS = ("data", "evt", "ack", "info")


class MqttLink(Link):
    mode = "mqtt"

    def __init__(self, host: str = "127.0.0.1", port: int = 1883, client_id: str = "chamgap-bridge") -> None:
        self.host, self.port = host, port
        self.connected = False
        self.error: str | None = None
        self.hint: str | None = None
        self._topic_node: dict[str, str] = {}  # 대문자 구역 → 토픽에 쓰인 이름 (명령을 같은 이름으로 보낸다)
        self._online: dict[str, bool] = {}
        self._lock = threading.Lock()
        self._on_line: LineCallback | None = None
        self._on_status: StatusCallback | None = None
        self.client = mqtt.Client(CallbackAPIVersion.VERSION2, client_id=client_id, clean_session=True)
        self.client.on_connect = self._handle_connect
        self.client.on_connect_fail = self._handle_connect_fail
        self.client.on_disconnect = self._handle_disconnect
        self.client.on_message = self._handle_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)

    # ------------------------------------------------------------ 시작·끝

    async def start(self, on_line: LineCallback, on_status: StatusCallback | None = None) -> None:
        self._on_line, self._on_status = on_line, on_status
        log.info("MQTT 브로커 %s:%d 에 연결 중…", self.host, self.port)
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    async def stop(self) -> None:
        await asyncio.to_thread(self._stop_sync)

    def _stop_sync(self) -> None:
        try:
            self.client.disconnect()
        finally:
            self.client.loop_stop()

    # ------------------------------------------------------------ paho 콜백 (paho 스레드)

    def _notify(self, event: str) -> None:
        if self._on_status:
            self._on_status({"event": event, "port": SRC, "error": self.error, "hint": self.hint})

    def _handle_connect(self, client: mqtt.Client, userdata: Any, flags: Any, reason: Any, props: Any) -> None:
        if getattr(reason, "is_failure", False):
            self.connected, self.error = False, f"브로커가 연결을 거부했어요: {reason}"
            self._notify("mqtt_error")
            return
        self.connected, self.error, self.hint = True, None, None
        client.subscribe(f"{TOPIC_ROOT}/+/+", qos=1)
        log.info("MQTT 연결됨 %s:%d (구독 %s/+/+)", self.host, self.port, TOPIC_ROOT)
        self._notify("mqtt_connected")

    def _handle_connect_fail(self, client: mqtt.Client, userdata: Any) -> None:
        first = self.error is None
        self.connected = False
        self.error = f"브로커 {self.host}:{self.port}에 연결할 수 없어요"
        self.hint = "노트북에서 Mosquitto가 실행 중인지 확인하세요 (포트 1883)"
        if first:
            log.warning("%s → %s", self.error, self.hint)
            self._notify("mqtt_error")

    def _handle_disconnect(self, client: mqtt.Client, userdata: Any, flags: Any, reason: Any, props: Any) -> None:
        was = self.connected
        self.connected = False
        if was:
            log.warning("MQTT 끊김 (%s) — 다시 연결합니다", reason)
            self._notify("mqtt_disconnected")

    def _handle_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        line = self.topic_to_line(msg.topic, msg.payload)
        if line is not None and self._on_line is not None:
            self._on_line(SRC, line)

    def topic_to_line(self, topic: str, payload: bytes) -> str | None:
        """토픽 + 내용 → hub가 해석할 한 줄. 무시할 것은 None."""
        parts = topic.split("/")
        if len(parts) != 3 or parts[0] != TOPIC_ROOT:
            return None
        node_seg, kind = parts[1], parts[2]
        if kind == "cmd":
            return None
        node = node_seg.upper()
        with self._lock:
            self._topic_node[node] = node_seg
        text = payload.decode("utf-8", errors="replace").strip()
        if kind == "online":
            online = text in ("1", "true", "on")
            with self._lock:
                self._online[node] = online
            return json.dumps({"t": "online", "node": node, "ms": None, "online": 1 if online else 0})
        if kind not in MSG_KINDS or not text:
            return None
        if text.startswith("{") and '"node"' not in text:
            # 토픽이 구역을 알려 주므로 빠진 node를 채운다 (내용은 그대로)
            try:
                obj = json.loads(text)
                if isinstance(obj, dict):
                    obj["node"] = node_seg
                    return json.dumps(obj, ensure_ascii=False)
            except ValueError:
                pass
        return text

    # ------------------------------------------------------------ 보내기·상태

    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        if not node or not self.connected:
            return False
        with self._lock:
            seg = self._topic_node.get(node.upper(), node)
        info = self.client.publish(f"{TOPIC_ROOT}/{seg}/cmd", text.rstrip("\n"), qos=1)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def status(self) -> dict[str, Any]:
        with self._lock:
            online = dict(self._online)
        return {
            "mode": "mqtt",
            "broker": f"{self.host}:{self.port}",
            "connected": self.connected,
            "error": self.error,
            "hint": self.hint,
            "ports": [{"port": SRC, "connected": self.connected, "error": self.error, "hint": self.hint}],
            "nodes_online": online,
        }

    def sources(self) -> list[str]:
        return [SRC] if self.connected else []
