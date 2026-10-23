"""LC_NO_RESP · LC_UNCAL · LC_NOISY · LC_NEGATIVE · LC_OVERLOAD · LC_DRIFT_UP"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def test_no_resp_after_15s_and_hides_other_lc(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(10, hx_ok=0, weight_g=None, weight_sd=None)
    assert "LC_NO_RESP" not in f.codes()
    f.run(10, hx_ok=0, weight_g=None, weight_sd=None)
    d = f.diag("LC_NO_RESP")
    assert d is not None and d["severity"] == "fault" and d["sensor"] == "scale"
    assert "LC_UNCAL" not in f.codes()  # 응답 없음이 원인 하나
    f.close()


def test_uncal_from_info_or_null_weight(tmp_path: Path) -> None:
    f = Feeder(tmp_path, lc_cal=0)
    f.run(5, weight_g=None, weight_sd=None)
    d = f.diag("LC_UNCAL")
    assert d is not None and d["severity"] == "info" and d["action"]["to"] == "/calibrate/Z1/scale"
    f.close()
    g = Feeder(tmp_path)
    g.run(5, weight_g=None, weight_sd=None)  # hx_ok=1인데 무게가 없음
    assert "LC_UNCAL" in g.codes()
    g.close()


def test_noisy_after_2_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(100, weight_sd=9.5)
    assert "LC_NOISY" not in f.codes()
    f.run(30, weight_sd=9.5)
    d = f.diag("LC_NOISY")
    assert d is not None and "±9.5g" in d["detail"]
    f.close()


def test_negative_after_1_minute(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(70, weight_g=-85.0)
    d = f.diag("LC_NEGATIVE")
    assert d is not None and d["action"]["label"] == "영점 다시 잡기"
    f.close()


def test_overload_is_immediate(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(5, weight_g=7400.0)
    d = f.diag("LC_OVERLOAD")
    assert d is not None and d["severity"] == "fault" and "7,400g" in d["detail"]
    f.close()


def rising(start: float, per_sample: float):  # type: ignore[no-untyped-def]
    return lambda i: start + i * per_sample


def test_drift_up_without_watering(tmp_path: Path) -> None:
    f = Feeder(tmp_path, sample_ms=600000)
    temp = lambda i: 23.0 + (i % 5) * 0.1
    f.run(70 * 60, every=60, tick=60, weight_g=rising(1234.0, 0.5), temp_a=temp, temp_b=temp)
    d = f.diag("LC_DRIFT_UP")
    assert d is not None and d["severity"] == "warn" and d["values"]["rise_g"] >= 25 and "기준 +20g" in d["detail"]
    f.close()


def test_drift_up_ignored_when_marked(tmp_path: Path) -> None:
    f = Feeder(tmp_path, sample_ms=600000)
    temp = lambda i: 23.0 + (i % 5) * 0.1
    f.run(30 * 60, every=60, tick=60, weight_g=rising(1234.0, 0.5), temp_a=temp, temp_b=temp)
    f.hub.mark("Z1", "Z1 물 20mL 줌")
    f.run(40 * 60, every=60, tick=60, weight_g=rising(1234.0, 0.5), temp_a=temp, temp_b=temp)
    assert "LC_DRIFT_UP" not in f.codes()
    f.close()
