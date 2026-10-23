from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from chamgap.api import create_app
from chamgap.clock import FakeClock
from chamgap.config import Config
from chamgap.hub import Hub
from chamgap.storage import Storage

from .helpers import AutoAckLink, FakeLink, data_line, evt_line, info_line

T0 = 1_792_713_600.0


def sample(**over: object) -> dict[str, object]:
    return json.loads(data_line("Z1", **over))


def test_history_bucket_average_skips_null(tmp_path: Path) -> None:
    st = Storage(tmp_path / "logs", tmp_path / "data")
    st.start()
    st.write_sample("Z1", T0 + 1, sample(seq=1, temp_a=20.0, temp_b=None))
    st.write_sample("Z1", T0 + 30, sample(seq=2, temp_a=22.0, temp_b=24.0))
    st.write_sample("Z1", T0 + 61, sample(seq=3, temp_a=30.0, temp_b=30.0))
    st.write_sample("Z2", T0 + 2, sample(seq=1, temp_a=99.0))
    st.flush()
    pts = st.history("Z1", ["temp_a", "temp_b"], T0, T0 + 120, bucket=60)
    assert [p["temp_a"] for p in pts] == [21.0, 30.0]
    assert [p["temp_b"] for p in pts] == [24.0, 30.0]  # null은 평균에서 빠진다
    raw = st.history("Z1", ["temp_a"], T0, T0 + 120, bucket=0)
    assert len(raw) == 3
    assert st.history("Z1", ["drop table"], T0, T0 + 120) == []
    st.stop()


def test_events_newest_first_and_filter(tmp_path: Path) -> None:
    st = Storage(tmp_path / "logs", tmp_path / "data")
    st.start()
    st.write_event("Z1", T0 + 1, "mark", {"note": "첫 메모"})
    st.write_event("Z1", T0 + 2, "diag_on", {"code": "LEAK"})
    st.write_event("Z2", T0 + 3, "diag_off", {"code": "LEAK"})
    st.flush()
    ev = st.events("Z1")
    assert [e["kind"] for e in ev] == ["diag_on", "mark"] and ev[1]["payload"]["note"] == "첫 메모"
    assert [e["node"] for e in st.events(kinds=["diag_off"])] == ["Z2"]
    st.stop()


def test_csv_has_bom_and_korean_header(tmp_path: Path) -> None:
    st = Storage(tmp_path / "logs", tmp_path / "data")
    st.start()
    st.write_sample("Z1", T0 + 1, {**sample(seq=1), "pc_time": "2026-10-23T09:00:01.000+09:00"})
    st.flush()
    text = "".join(st.export_csv("Z1", T0, T0 + 10))
    assert text.startswith("﻿시각,구역,순번,온도A(°C)")
    lines = text.strip().splitlines()
    assert len(lines) == 2 and lines[1].startswith("2026-10-23T09:00:01.000+09:00,Z1,1,23.4")
    # 엑셀이 여는 방식(utf-8-sig)으로 읽어도 한글이 그대로
    assert text.encode("utf-8").decode("utf-8-sig").startswith("시각")
    st.stop()


def test_old_samples_deleted_on_start(tmp_path: Path) -> None:
    st = Storage(tmp_path / "logs", tmp_path / "data", keep_days=30)
    st.start()
    now = time.time()
    st.write_sample("Z1", now - 40 * 86400, sample(seq=1))
    st.write_sample("Z1", now - 1, sample(seq=2))
    st.stop()
    st2 = Storage(tmp_path / "logs", tmp_path / "data", keep_days=30)
    st2.start()
    assert len(st2.history("Z1", ["temp_a"], 0, now + 10, bucket=0)) == 1
    st2.stop()


def test_hub_restores_recent_history_after_restart(cfg: Config) -> None:
    import asyncio

    clock = FakeClock()
    st = Storage(cfg.log_dir, cfg.data_dir)
    st.start()
    hub = Hub(cfg, FakeLink(), clock, st)
    hub.process_line("COM5", info_line("Z1", soil_cal=0))
    for i in range(1, 6):
        clock.advance(5)
        hub.process_line("COM5", data_line("Z1", seq=i))
    hub.process_line("COM5", evt_line("Z1", "pump_on", dur=4255, ml=10.0))
    hub.process_line("COM5", evt_line("Z1", "pump_off", reason="done", dur=4255, ran=4255, ml=10.0))
    hub.mark("Z1", "손으로 물 줌")
    st.stop()

    st2 = Storage(cfg.log_dir, cfg.data_dir)
    hub2 = Hub(cfg, FakeLink(), clock, st2)

    async def boot() -> None:
        await hub2.start()
        await hub2.stop()

    asyncio.run(boot())
    node = hub2.nodes["Z1"]
    assert node.latest is not None and node.latest["seq"] == 5 and node.last_seq == 5
    assert node.info is not None and node.info["soil_cal"] == 0
    assert node.pump.today_ml == 10.0
    assert len(hub2.histories["Z1"].samples) >= 2
    assert hub2.histories["Z1"].last_event(["mark"]) is not None


def test_history_and_csv_api(cfg: Config) -> None:
    link = AutoAckLink()
    app = create_app(cfg, link=link)
    with TestClient(app) as client:
        for i in range(1, 4):
            link.on_line("COM5", data_line("Z1", seq=i, weight_g=1200.0 + i))
        for _ in range(50):
            if app.state.hub.nodes.get("Z1") and app.state.hub.nodes["Z1"].last_seq == 3:
                break
            client.get("/api/link")
        app.state.hub.storage.flush()
        r = client.get("/api/history", params={"node": "Z1", "metric": "weight_g", "minutes": 60, "bucket": 60})
        body = r.json()
        assert r.status_code == 200 and body["ok"] and body["points"] and body["points"][-1]["weight_g"] > 1200
        assert client.get("/api/history", params={"node": "Z1", "metric": "nope"}).status_code == 400
        assert client.post("/api/mark", json={"node": "Z1", "note": "Z1 물 20mL 줌"}).json()["ok"]
        app.state.hub.storage.flush()
        ev = client.get("/api/events", params={"node": "Z1", "kind": "mark"}).json()["events"]
        assert ev[0]["payload"]["note"] == "Z1 물 20mL 줌"
        csv = client.get("/api/export.csv", params={"node": "Z1"})
        assert csv.status_code == 200 and "attachment" in csv.headers["content-disposition"]
        assert csv.content.startswith("﻿시각".encode()) and csv.text.count("\n") >= 4
