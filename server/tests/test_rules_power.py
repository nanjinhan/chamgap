"""V12_MISSING · LEAK"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def test_v12_missing_after_3s(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(2, every=1, v12=0.2)
    assert "V12_MISSING" not in f.codes()
    f.run(3, every=1, v12=0.2)
    d = f.diag("V12_MISSING")
    assert d is not None and d["sensor"] == "power" and "0.2V" in d["detail"]
    assert f.hub.active_codes("Z1") >= {"V12_MISSING"}  # 급수 안전 검사가 이것을 본다
    f.close()


def test_v12_not_used_is_silent(tmp_path: Path) -> None:
    f = Feeder(tmp_path, v12_sense=0)
    f.run(10, v12=None)
    assert "V12_MISSING" not in f.codes()
    f.close()


def test_leak_is_immediate_fault(tmp_path: Path) -> None:
    f = Feeder(tmp_path, leak_sensor=1)
    f.run(5, leak=0)
    assert "LEAK" not in f.codes()
    f.run(1, leak=1)
    d = f.diag("LEAK")
    assert d is not None and d["severity"] == "fault"
    pf = f.hub.preflight("Z1", 10)
    assert pf.first_fail is not None and pf.first_fail.key == "leak"
    f.close()
