"""MQTT 링크: 토픽 → 줄 변환 (단위) + 실제 브로커를 거치는 왕복 (amqtt가 있으면)."""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator
from typing import Any

import paho.mqtt.client as mqtt
import pytest
from fastapi.testclient import TestClient
from paho.mqtt.enums import CallbackAPIVersion

from chamgap.api import create_app
from chamgap.config import Config
from chamgap.links.mqtt_link import MqttLink

from .helpers import data_line, info_line


def test_topic_to_line() -> None:
    link = MqttLink()
    assert link.topic_to_line("chamgap/Z1/data", data_line("Z1").encode()) == data_line("Z1")
    assert link.topic_to_line("chamgap/Z1/cmd", b"water 10") is None  # 우리가 보낸 명령
    assert link.topic_to_line("other/Z1/data", b"{}") is None
    online = json.loads(link.topic_to_line("chamgap/z2/online", b"0") or "")
    assert online == {"t": "online", "node": "Z2", "ms": None, "online": 0}
    assert link.status()["nodes_online"] == {"Z2": False}
    filled = json.loads(link.topic_to_line("chamgap/Z3/ack", b'{"t":"ack","ms":1,"cmd":"info","ok":1}') or "")
    assert filled["node"] == "Z3"  # 토픽으로 node를 채운다


def test_send_fails_when_not_connected() -> None:
    link = MqttLink(port=1)
    assert asyncio.run(link.send("Z1", None, "info")) is False


# ---------------------------------------------------------------- 실제 브로커 왕복


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def broker_port() -> Iterator[int]:
    amqtt_broker = pytest.importorskip("amqtt.broker")
    port = _free_port()
    loop = asyncio.new_event_loop()
    holder: dict[str, Any] = {}
    ready = threading.Event()

    def run() -> None:
        asyncio.set_event_loop(loop)

        async def boot() -> None:
            b = amqtt_broker.Broker({"listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{port}"}}})
            await b.start()
            holder["b"] = b

        loop.run_until_complete(boot())
        ready.set()
        loop.run_forever()

    th = threading.Thread(target=run, daemon=True)
    th.start()
    assert ready.wait(10)
    yield port
    asyncio.run_coroutine_threadsafe(holder["b"].shutdown(), loop).result(10)
    loop.call_soon_threadsafe(loop.stop)
    th.join(5)


class FakeEsp32:
    """MQTT로 붙는 가짜 ESP32: cmd를 받으면 ack를 보낸다."""

    def __init__(self, port: int, node: str = "Z1") -> None:
        self.node = node
        self.cmds: list[str] = []
        self.c = mqtt.Client(CallbackAPIVersion.VERSION2, client_id=f"esp32-{node}")
        self.c.will_set(f"chamgap/{node}/online", "0", qos=1, retain=True)
        self.c.on_message = self._on_cmd
        self.c.connect("127.0.0.1", port)
        self.c.subscribe(f"chamgap/{node}/cmd", qos=1)
        self.c.loop_start()

    def _on_cmd(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        text = msg.payload.decode()
        self.cmds.append(text)
        ack = {"t": "ack", "node": self.node, "ms": 1, "cmd": text.split()[0], "ok": 1, "msg": ""}
        self.pub("ack", json.dumps(ack))

    def pub(self, kind: str, payload: str, retain: bool = False) -> None:
        self.c.publish(f"chamgap/{self.node}/{kind}", payload, qos=1, retain=retain)

    def close(self) -> None:
        self.c.loop_stop()
        self.c.disconnect()


def _until(pred: Any, client: TestClient, timeout: float = 8.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        client.get("/api/link")
        time.sleep(0.05)
    return False


def test_roundtrip_through_broker(cfg: Config, broker_port: int) -> None:
    cfg.mode = "mqtt"
    cfg.mqtt.port = broker_port
    app = create_app(cfg)
    hub = app.state.hub
    with TestClient(app) as client:
        assert _until(lambda: client.get("/api/link").json()["connected"], client)
        esp = FakeEsp32(broker_port)
        esp.pub("online", "1", retain=True)
        esp.pub("info", info_line("Z1"))
        esp.pub("data", data_line("Z1", seq=1, rssi=-58))
        assert _until(lambda: "Z1" in hub.nodes and hub.nodes["Z1"].online and hub.nodes["Z1"].info, client)
        assert hub.routes["Z1"] == "mqtt" and hub.nodes["Z1"].latest["rssi"] == -58
        # 명령 → chamgap/Z1/cmd → ack → API 응답
        r = client.post("/api/nodes/Z1/command", json={"cmd": "info"})
        assert r.status_code == 200 and r.json()["ok"] is True
        assert "info" in esp.cmds
        # 브로커 유언 메시지(online=0) → 바로 오프라인 진단
        esp.pub("online", "0", retain=True)
        assert _until(lambda: "NODE_OFFLINE" in {d["code"] for d in hub.nodes["Z1"].diagnostics}, client)
        d = next(x for x in hub.nodes["Z1"].diagnostics if x["code"] == "NODE_OFFLINE")
        assert "WiFi" in d["detail"]
        esp.close()


def test_broker_down_reports_hint(cfg: Config) -> None:
    cfg.mode = "mqtt"
    cfg.mqtt.port = _free_port()  # 아무도 듣지 않는 포트
    app = create_app(cfg)
    with TestClient(app) as client:
        assert _until(lambda: client.get("/api/link").json()["error"] is not None, client)
        st = client.get("/api/link").json()
        assert st["connected"] is False and "Mosquitto" in st["hint"]
