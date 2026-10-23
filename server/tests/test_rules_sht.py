"""SHT_NO_RESP · SHT_RANGE · SHT_AB_DIFF · SHT_STUCK"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def wobble(base: float, amp: float = 0.1):  # type: ignore[no-untyped-def]
    return lambda i: base + (amp if i % 2 else -amp)


def test_no_resp_after_15s(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(10, sht_b_ok=0, temp_b=None, rh_b=None)
    assert "SHT_NO_RESP" not in f.codes()
    f.run(10, sht_b_ok=0, temp_b=None, rh_b=None)
    assert ("SHT_NO_RESP", "sht_b") in f.diag_keys()
    d = f.diag("SHT_NO_RESP")
    assert d is not None and d["title"] == "온습도 B (비교) 응답 없음" and d["severity"] == "fault"
    node = f.hub.nodes["Z1"]
    assert node.sensors()["sht_b"]["status"] == "fault" and node.sensors()["sht_a"]["status"] == "ok"
    assert node.status() == "fault"
    f.close()


def test_range_is_immediate(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(5, temp_a=72.0)
    d = f.diag("SHT_RANGE")
    assert d is not None and d["sensor"] == "sht_a" and "72.0°C" in d["detail"]
    f.close()


def test_ab_diff_needs_10_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(9 * 60, temp_b=26.1)
    assert "SHT_AB_DIFF" not in f.codes()
    f.run(90, temp_b=26.1)
    d = f.diag("SHT_AB_DIFF")
    assert d is not None and d["sensor"] == "sht_b" and d["severity"] == "warn"
    assert "B가 A보다 2.7°C 높음 (기준 1.0°C)" in d["detail"] and "10분째" in d["detail"]
    assert d["action"] == {"label": "센서 보기", "to": "/zone/Z1/sensor/sht_b"}
    assert d["values"]["d_temp"] == 2.7
    # 정상으로 돌아와도 유지 시간(10분) 동안은 남아 있다 (DX-02)
    f.run(5 * 60)
    assert "SHT_AB_DIFF" in f.codes()
    f.run(6 * 60)
    assert "SHT_AB_DIFF" not in f.codes()
    f.close()


def test_ab_diff_humidity(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(11 * 60, rh_b=38.0)
    d = f.diag("SHT_AB_DIFF")
    assert d is not None and "습도 B가 A보다 7.1% 낮음" in d["detail"]
    f.close()


def test_brief_spike_does_not_flash(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(60, temp_b=26.0)
    f.run(60)
    f.run(60, temp_b=26.0)
    assert "SHT_AB_DIFF" not in f.codes()
    f.close()


def test_stuck_after_30_minutes(tmp_path: Path) -> None:
    f = Feeder(tmp_path, sample_ms=60000)
    f.run(25 * 60, every=60, tick=60, temp_b=wobble(23.6), rh_b=wobble(44.6, 0.5))
    assert "SHT_STUCK" not in f.codes()
    f.run(10 * 60, every=60, tick=60, temp_b=wobble(23.6), rh_b=wobble(44.6, 0.5))
    assert ("SHT_STUCK", "sht_a") in f.diag_keys() and ("SHT_STUCK", "sht_b") not in f.diag_keys()
    f.close()


def test_no_resp_hides_stuck_and_range(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20, sht_a_ok=0, temp_a=99.0)
    assert ("SHT_NO_RESP", "sht_a") in f.diag_keys() and "SHT_RANGE" not in f.codes()
    f.close()
