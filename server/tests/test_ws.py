from __future__ import annotations

import asyncio
from typing import Any

from fastapi.testclient import TestClient

from chamgap.api import create_app
from chamgap.config import Config
from chamgap.state import SENSOR_KEYS
from chamgap.ws import MAX_QUEUE, WsManager, _Client

from .helpers import AutoAckLink, data_line, info_line


def test_snapshot_then_live_messages(cfg: Config) -> None:
    link = AutoAckLink()
    app = create_app(cfg, link=link)
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and "nodes" in snap["state"] and "link" in snap["state"]
        link.on_line("COM5", info_line("Z1"))
        link.on_line("COM5", data_line("Z1", seq=1))
        seen: dict[str, dict[str, Any]] = {}
        for _ in range(20):
            m = ws.receive_json()
            seen.setdefault(m["type"], m)
            if "data" in seen and "link" in seen:
                break
        assert seen["data"]["node"] == "Z1" and seen["data"]["payload"]["seq"] == 1
        assert "pc_time" in seen["data"]["payload"] and seen["data"]["online"] is True
        assert seen["link"]["payload"]["event"] == "node_online"


def test_log_and_test_messages(cfg: Config) -> None:
    link = AutoAckLink()
    app = create_app(cfg, link=link)
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        ws.receive_json()
        link.on_line("COM5", "# 공기 중에 두세요")
        link.on_line("COM5", '{"t":"soil","ms":10,"a_mv":2400,"a_flag":"ok"}')
        got = [ws.receive_json() for _ in range(2)]
        assert got[0]["type"] == "log" and got[0]["payload"]["note"] is True
        assert got[1]["type"] == "test" and got[1]["payload"]["a_mv"] == 2400


def test_state_matches_spec_5_3(cfg: Config) -> None:
    link = AutoAckLink()
    app = create_app(cfg, link=link)
    with TestClient(app) as client:
        link.on_line("COM5", info_line("Z1", pump_mlps=0))
        link.on_line("COM5", data_line("Z1", seq=1))
        for _ in range(50):
            if app.state.hub.nodes.get("Z1") and app.state.hub.nodes["Z1"].diagnostics:
                break
            client.get("/api/link")
        st = client.get("/api/state").json()
        assert {"server_time", "link", "nodes"} <= set(st)
        z1 = st["nodes"]["Z1"]
        assert {"online", "last_seen", "status", "latest", "info", "pump", "sensors", "diagnostics"} <= set(z1)
        assert set(z1["sensors"]) == set(SENSOR_KEYS)
        assert z1["sensors"]["sht_a"] == {"status": "ok", "value": {"temp": 23.4, "rh": 45.1}}
        assert z1["sensors"]["pump"]["status"] == "info"  # FLOW_UNCAL
        assert z1["status"] == "info" and z1["diagnostics"][0]["code"] == "FLOW_UNCAL"
        assert {"on", "last_ml", "last_at", "today_ml"} <= set(z1["pump"])
        node = client.get("/api/nodes/Z1").json()
        assert node["recent"][0]["t"] == "data" and node["route"] == "COM5"
        assert client.get("/api/diagnostics").json()["diagnostics"][0]["code"] == "FLOW_UNCAL"


class _FakeWs:
    client = None


def test_slow_client_is_dropped() -> None:
    async def main() -> None:
        mgr = WsManager()
        c = _Client(_FakeWs())  # type: ignore[arg-type]
        mgr.clients.add(c)
        for i in range(MAX_QUEUE):
            mgr.broadcast({"type": "ping", "i": i})
        assert c in mgr.clients
        mgr.broadcast({"type": "ping"})  # 501번째
        assert c not in mgr.clients and c.dropped

    asyncio.run(main())
