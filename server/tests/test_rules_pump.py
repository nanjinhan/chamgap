"""WATER_NOT_ARRIVED · WATER_OVER · PUMP_REFUSED · FLOW_UNCAL"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def water(f: Feeder, after_g: float, wait_s: float = 130) -> None:
    f.run(20)  # 급수 전 안정된 무게 1234.5g
    f.evt("pump_on", dur=4255, ml=10.0)
    f.run(5)
    f.evt("pump_off", reason="done", dur=4255, ran=4255, ml=10.0)
    f.run(wait_s, weight_g=after_g)


def test_water_ok_records_result(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    water(f, after_g=1244.1, wait_s=40)
    run = f.hub.waters["Z1"].last
    assert run is not None and run.verdict == "ok" and run.delta_g == 9.6 and run.before_g == 1234.5
    assert not {"WATER_NOT_ARRIVED", "WATER_OVER"} & f.codes()
    f.close()


def test_not_arrived_after_2_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    water(f, after_g=1235.7, wait_s=100)
    assert "WATER_NOT_ARRIVED" not in f.codes()  # 아직 2분 안 됨
    f.run(30, weight_g=1235.7)
    d = f.diag("WATER_NOT_ARRIVED")
    assert d is not None and d["severity"] == "fault" and "10mL 줬는데" in d["detail"] and "+1.2g" in d["detail"]
    assert d["action"] == {"label": "급수 화면", "to": "/water/Z1"}
    f.close()


def test_over(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    water(f, after_g=1252.0)
    d = f.diag("WATER_OVER")
    assert d is not None and d["severity"] == "warn" and "+17.5g" in d["detail"]
    assert d["action"]["to"] == "/calibrate/Z1/flow"
    f.close()


def test_unstable_weight_is_not_compared(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20)
    f.evt("pump_on", dur=4255, ml=10.0)
    f.evt("pump_off", reason="done", dur=4255, ran=4255, ml=10.0)
    f.run(130, weight_g=1260.0, weight_sd=8.0)  # 흔들려서 비교 안 함
    run = f.hub.waters["Z1"].last
    assert run is not None and run.verdict == "unknown"
    assert "WATER_OVER" not in f.codes()
    f.close()


def test_stopped_watering_is_not_judged(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20)
    f.evt("pump_on", dur=4255, ml=10.0)
    f.evt("pump_off", reason="stop", dur=4255, ran=1000, ml=10.0)
    f.run(130)
    assert f.hub.waters["Z1"].last is None and "WATER_NOT_ARRIVED" not in f.codes()
    f.close()


def test_refused_shows_reason_for_2_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(5)
    f.evt("refused", reason="cooldown", dur=4255, ml=10.0)
    f.run(5)
    d = f.diag("PUMP_REFUSED")
    assert d is not None and d["title"] == "펌프 요청이 거부됨 (쉬는 시간)" and "3초" in d["detail"]
    f.run(135)
    assert "PUMP_REFUSED" not in f.codes()
    f.close()


def test_refused_no_12v_hidden_by_v12_missing(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(5, v12=0.0)
    f.evt("refused", reason="no_12v", dur=4255, ml=10.0)
    f.run(5, v12=0.0)
    assert "V12_MISSING" in f.codes() and "PUMP_REFUSED" not in f.codes()  # 원인 하나 (DX-06)
    f.close()


def test_flow_uncal(tmp_path: Path) -> None:
    f = Feeder(tmp_path, pump_mlps=0.0)
    f.run(5)
    d = f.diag("FLOW_UNCAL")
    assert d is not None and d["severity"] == "info" and d["action"] == {"label": "보정하기", "to": "/calibrate/Z1/flow"}
    f.close()
