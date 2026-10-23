"""SOIL_WIRE · SOIL_UNCAL · SOIL_AB_DIFF · SOIL_NO_RISE · SOIL_STUCK"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def test_wire_low_is_signal_unplugged(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20, soil_a_mv=12, soil_a=None)
    d = f.diag("SOIL_WIRE")
    assert d is not None and d["sensor"] == "soil_a" and "신호선" in d["title"] and "12mV" in d["detail"]
    assert any("GPIO32" in c for c in d["checks"])
    f.close()


def test_wire_high_is_gnd_or_short(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20, soil_b_mv=3200, soil_b=None)
    d = f.diag("SOIL_WIRE")
    assert d is not None and d["sensor"] == "soil_b" and "GND" in d["title"]
    f.close()


def test_uncal_is_info_with_calibrate_button(tmp_path: Path) -> None:
    f = Feeder(tmp_path, soil_cal=0)
    f.run(5)
    assert {("SOIL_UNCAL", "soil_a"), ("SOIL_UNCAL", "soil_b")} <= f.diag_keys()
    d = f.diag("SOIL_UNCAL")
    assert d is not None and d["severity"] == "info"  # 보정 전은 fault가 아니다 (DX-05)
    assert d["action"] == {"label": "보정하기", "to": "/calibrate/Z1/soil"}
    assert f.hub.nodes["Z1"].status() == "info"
    f.info(soil_cal=1)
    f.run(15)
    assert "SOIL_UNCAL" not in f.codes()
    f.close()


def test_ab_diff_after_10_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(11 * 60, soil_b=0.20)
    d = f.diag("SOIL_AB_DIFF")
    assert d is not None and "B가 A보다 0.33 낮음" in d["detail"]
    f.close()


def test_ab_diff_hidden_while_uncalibrated(tmp_path: Path) -> None:
    f = Feeder(tmp_path, soil_cal=0)
    f.run(11 * 60, soil_b=0.20)
    assert "SOIL_AB_DIFF" not in f.codes() and "SOIL_UNCAL" in f.codes()
    f.close()


def _water(f: Feeder, after_g: float, soil_a: float, soil_b: float) -> None:
    f.run(20)
    f.evt("pump_on", dur=4255, ml=10.0)
    f.run(5)
    f.evt("pump_off", reason="done", dur=4255, ran=4255, ml=10.0)
    f.run(16 * 60, weight_g=after_g, soil_a=soil_a, soil_b=soil_b)


def test_no_rise_when_weight_arrived_but_soil_flat(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    _water(f, after_g=1244.3, soil_a=0.535, soil_b=0.58)
    assert f.hub.waters["Z1"].last is not None and f.hub.waters["Z1"].last.verdict == "ok"
    keys = f.diag_keys()
    assert ("SOIL_NO_RISE", "soil_a") in keys and ("SOIL_NO_RISE", "soil_b") not in keys
    d = f.diag("SOIL_NO_RISE")
    assert d is not None and "+9.8g" in d["detail"]
    f.close()


def test_no_rise_skipped_when_water_did_not_arrive(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    _water(f, after_g=1234.6, soil_a=0.53, soil_b=0.51)
    assert "SOIL_NO_RISE" not in f.codes() and "WATER_NOT_ARRIVED" in f.codes()
    f.close()


def test_stuck_after_6_hours(tmp_path: Path) -> None:
    f = Feeder(tmp_path, sample_ms=600000)
    temp = lambda i: 23.0 + (i % 7) * 0.1
    f.run(5 * 3600, every=300, tick=300, temp_a=temp, temp_b=temp)
    assert "SOIL_STUCK" not in f.codes()
    f.run(3600 + 600, every=300, tick=300, temp_a=temp, temp_b=temp, soil_b_mv=lambda i: 1800 + i * 3)
    keys = f.diag_keys()
    assert ("SOIL_STUCK", "soil_a") in keys and ("SOIL_STUCK", "soil_b") not in keys
    assert f.diag("SOIL_STUCK")["severity"] == "info"  # type: ignore[index]
    f.close()
