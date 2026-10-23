"""테스트 도우미: 메시지 줄 만들기, 가짜 링크."""

from __future__ import annotations

import json
from typing import Any

from chamgap.links.base import LineCallback, Link, StatusCallback


def data_line(node: str = "Z1", seq: int = 1, **over: Any) -> str:
    d: dict[str, Any] = {
        "t": "data", "node": node, "ms": seq * 5000, "seq": seq,
        "sht_a_ok": 1, "temp_a": 23.4, "rh_a": 45.1,
        "sht_b_ok": 1, "temp_b": 23.6, "rh_b": 44.6,
        "soil_a_mv": 1800, "soil_a": 0.53, "soil_b_mv": 1830, "soil_b": 0.51,
        "hx_ok": 1, "weight_g": 1234.5, "weight_sd": 0.4,
        "v12": 12.0, "leak": None, "pump": 0, "rssi": None,
    }
    d.update(over)
    return json.dumps(d)


def info_line(node: str = "Z1", **over: Any) -> str:
    d: dict[str, Any] = {
        "t": "info", "node": node, "ms": 200, "fw": "node-0.1", "sample_ms": 5000,
        "soil_cal": 1, "soil_a_air": 2500, "soil_a_wet": 1200, "soil_b_air": 2500, "soil_b_wet": 1200,
        "lc_cal": 1, "lc_offset": 81234, "lc_scale": 412.5, "pump_mlps": 2.35,
        "v12_sense": 1, "leak_sensor": 0, "mqtt": 0,
    }
    d.update(over)
    return json.dumps(d)


def evt_line(node: str, ev: str, **kw: Any) -> str:
    return json.dumps({"t": "evt", "node": node, "ms": 1, "ev": ev, **kw})


def ack_line(node: str, cmd: str, ok: int = 1, msg: str = "") -> str:
    return json.dumps({"t": "ack", "node": node, "ms": 1, "cmd": cmd, "ok": ok, "msg": msg})


class FakeLink(Link):
    """보낸 명령을 기록만 하는 링크."""

    mode = "serial"

    def __init__(self) -> None:
        self.sent: list[tuple[str | None, str | None, str]] = []
        self.ok = True

    async def start(self, on_line: LineCallback, on_status: StatusCallback | None = None) -> None:
        self.on_line = on_line

    async def stop(self) -> None:
        pass

    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        self.sent.append((node, src, text))
        return self.ok

    def status(self) -> dict[str, Any]:
        return {"mode": "serial", "ports": [{"port": "COM5", "connected": True}]}

    def sources(self) -> list[str]:
        return ["COM5"]


class AutoAckLink(FakeLink):
    """명령을 받으면 곧바로 ack를 돌려주는 링크 (replies로 거부 흉내)."""

    def __init__(self, node: str = "Z1") -> None:
        super().__init__()
        self.node = node
        self.replies: dict[str, tuple[int, str]] = {}

    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        from chamgap.protocol import command_name

        self.sent.append((node, src, text))
        name = command_name(text)
        ok, msg = self.replies.get(name, (1, ""))
        self.on_line(src or "COM5", ack_line(node or self.node, name, ok, msg))
        return True
