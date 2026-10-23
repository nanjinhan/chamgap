from __future__ import annotations

import json

from chamgap.clock import FakeClock, local_date
from chamgap.config import Config
from chamgap.hub import Hub, summarize_data
from chamgap.storage import Storage

from .helpers import FakeLink, data_line, evt_line, info_line


def make_hub(cfg: Config, clock: FakeClock) -> Hub:
    storage = Storage(cfg.log_dir, cfg.data_dir)
    storage.start()
    return Hub(cfg, FakeLink(), clock, storage)


def test_data_updates_node_and_route(cfg: Config, clock: FakeClock) -> None:
    hub = make_hub(cfg, clock)
    hub.process_line("COM5", data_line("Z1", seq=1))
    hub.process_line("COM5", info_line("Z1"))
    node = hub.nodes["Z1"]
    assert node.online and node.latest is not None and node.latest["seq"] == 1
    assert node.info is not None and node.info["pump_mlps"] == 2.35
    assert hub.routes["Z1"] == "COM5"
    assert hub.link_status()["ports"][0]["node"] == "Z1"
    hub.storage.stop()


def test_jsonl_written_per_date(cfg: Config, clock: FakeClock) -> None:
    hub = make_hub(cfg, clock)
    hub.process_line("COM5", data_line("Z1", seq=1, new_key="kept"))
    hub.process_line("COM5", "# 메모 줄")
    hub.process_line("COM5", "ets Jul 29 2019 boot log")
    hub.storage.flush()
    path = cfg.log_dir / local_date(clock.now()) / "all.jsonl"
    every = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
    assert any(x["t"] == "_server" and x["kind"] == "link" for x in every)  # 구역 온라인 사건
    lines = [x for x in every if x["t"] != "_server"]
    assert lines[0]["t"] == "data" and lines[0]["new_key"] == "kept" and lines[0]["src"] == "COM5"
    assert lines[1]["t"] == "_log" and lines[1]["note"] is True
    assert lines[2]["t"] == "_log" and lines[2]["note"] is False
    hub.storage.stop()


def test_pump_events_track_today_ml(cfg: Config, clock: FakeClock) -> None:
    hub = make_hub(cfg, clock)
    hub.process_line("COM5", data_line("Z1"))
    hub.process_line("COM5", evt_line("Z1", "pump_on", dur=4255, ml=10.0))
    assert hub.nodes["Z1"].pump.on and hub.nodes["Z1"].pump.today_ml == 10.0
    clock.advance(4.3)
    hub.process_line("COM5", evt_line("Z1", "pump_off", reason="done", dur=4255, ran=4255, ml=10.0))
    p = hub.nodes["Z1"].pump
    assert not p.on and p.today_ml == 10.0 and p.last_ml == 10.0
    # 일찍 멈추면 켜진 시간만큼만
    hub.process_line("COM5", evt_line("Z1", "pump_on", dur=4000, ml=10.0))
    hub.process_line("COM5", evt_line("Z1", "pump_off", reason="stop", dur=4000, ran=2000, ml=10.0))
    assert abs(hub.nodes["Z1"].pump.today_ml - 15.0) < 1e-6
    hub.storage.stop()


def test_test_sketch_message_does_not_create_node(cfg: Config, clock: FakeClock) -> None:
    hub = make_hub(cfg, clock)
    hub.process_line("COM5", '{"t":"soil","ms":10,"a_mv":2400,"a_flag":"ok"}')
    assert hub.nodes == {}
    hub.storage.stop()


def test_console_summary() -> None:
    d = json.loads(data_line("Z1", seq=42, rh_a=45.1, weight_g=1234.4))
    assert summarize_data(d) == "Z1 #42 23.4°C 45% 흙 0.53 1234g"
    d["temp_a"] = None
    assert "--" in summarize_data(d)
