"""엔진: 진단 형식(6.2), yaml(DX-03), 억제(DX-06), 문구(DX-01)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from chamgap.config import DEFAULT_DIAGNOSTICS
from chamgap.diagnostics.engine import DiagnosticEngine, suppress
from chamgap.diagnostics.rules import RULE_CLASSES
from chamgap.diagnostics.texts import text_for

from .sim import Feeder

SPEC_KEYS = {"code", "node", "sensor", "severity", "title", "detail", "causes", "checks", "since", "action"}


def test_24_rules_all_loaded() -> None:
    eng = DiagnosticEngine(DEFAULT_DIAGNOSTICS)
    assert len({r.code for r in eng.rules}) == 24


@pytest.mark.parametrize("cls", RULE_CLASSES, ids=lambda c: c.code)
def test_every_rule_has_korean_text(cls: type) -> None:
    for sensor in cls.sensors:  # type: ignore[attr-defined]
        t = text_for(cls.code, sensor)  # type: ignore[attr-defined]
        assert t.title and t.causes and t.checks
        assert "{" not in t.title and all("{" not in c for c in t.checks)


def test_diagnostic_format_matches_spec(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(11 * 60, temp_b=26.1)
    d = f.diag("SHT_AB_DIFF")
    assert d is not None and SPEC_KEYS <= set(d)
    assert isinstance(d["causes"], list) and isinstance(d["checks"], list) and len(d["checks"]) >= 2
    assert d["since"].startswith("20") and "T" in d["since"]
    f.close()


def test_yaml_values_drive_rules(tmp_path: Path) -> None:
    path = tmp_path / "diag.yaml"
    shutil.copy(DEFAULT_DIAGNOSTICS, path)
    eng = DiagnosticEngine(path)
    rule = next(r for r in eng.rules if r.code == "SHT_AB_DIFF")
    assert rule.hold_s == 600 and rule.p("temp_diff", 0) == 1.0
    text = path.read_text(encoding="utf-8").replace("temp_diff: 1.0", "temp_diff: 3.5")
    path.write_text(text, encoding="utf-8")
    eng.reload()
    rule = next(r for r in eng.rules if r.code == "SHT_AB_DIFF")
    assert rule.p("temp_diff", 0) == 3.5


def test_bad_yaml_keeps_old_rules(tmp_path: Path) -> None:
    path = tmp_path / "diag.yaml"
    shutil.copy(DEFAULT_DIAGNOSTICS, path)
    eng = DiagnosticEngine(path)
    before = len(eng.rules)
    path.write_text("rules:\n  NOT_A_RULE: {}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="모르는 규칙"):
        eng.reload()
    path.write_text("rules: [oops", encoding="utf-8")
    with pytest.raises(ValueError):
        eng.reload()
    assert len(eng.rules) == before


def test_mock_speed_shortens_holds() -> None:
    eng = DiagnosticEngine(DEFAULT_DIAGNOSTICS, time_scale=5)
    rule = next(r for r in eng.rules if r.code == "SHT_AB_DIFF")
    assert rule.hold_s == 120
    stuck = next(r for r in eng.rules if r.code == "SHT_STUCK")
    assert stuck.p("window_s", 0) == 360


def test_clear_s_minimum_10s() -> None:
    eng = DiagnosticEngine(DEFAULT_DIAGNOSTICS)
    leak = next(r for r in eng.rules if r.code == "LEAK")
    assert leak.hold_s == 0 and leak.clear_s == 10
    off = next(r for r in eng.rules if r.code == "NODE_OFFLINE")
    assert off.clear_s == 0  # yaml에서 직접 정함


def d(code: str, sensor: str, **values: object) -> dict[str, object]:
    return {"code": code, "sensor": sensor, "values": values}


@pytest.mark.parametrize(
    ("active", "visible"),
    [
        ([d("NODE_OFFLINE", "node"), d("SOIL_UNCAL", "soil_a"), d("LEAK", "power")], {"NODE_OFFLINE"}),
        ([d("V12_MISSING", "power"), d("WATER_NOT_ARRIVED", "pump")], {"V12_MISSING"}),
        ([d("V12_MISSING", "power"), d("PUMP_REFUSED", "pump", reason="no_12v")], {"V12_MISSING"}),
        ([d("V12_MISSING", "power"), d("PUMP_REFUSED", "pump", reason="cooldown")], {"V12_MISSING", "PUMP_REFUSED"}),
        ([d("SHT_NO_RESP", "sht_b"), d("SHT_AB_DIFF", "sht_b"), d("SHT_STUCK", "sht_b"), d("SHT_STUCK", "sht_a")],
         {"SHT_NO_RESP", "SHT_STUCK"}),
        ([d("SOIL_WIRE", "soil_a"), d("SOIL_AB_DIFF", "soil_b"), d("SOIL_STUCK", "soil_a")], {"SOIL_WIRE"}),
        ([d("SOIL_UNCAL", "soil_a"), d("SOIL_AB_DIFF", "soil_b")], {"SOIL_UNCAL"}),
        ([d("LC_NO_RESP", "scale"), d("LC_UNCAL", "scale"), d("WATER_OVER", "pump"), d("FLOW_UNCAL", "pump")],
         {"LC_NO_RESP", "FLOW_UNCAL"}),
    ],
)
def test_suppression(active: list[dict[str, object]], visible: set[str]) -> None:
    assert {x["code"] for x in suppress(active)} == visible  # type: ignore[arg-type]


def test_diag_events_recorded_on_and_off(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    seen: list[dict[str, object]] = []
    f.hub.emit_hooks.append(seen.append)
    f.run(20, hx_ok=0, weight_g=None, weight_sd=None)
    f.run(20)
    kinds = [m["type"] for m in seen]
    diag_msgs = [m for m in seen if m["type"] == "diag"]
    assert "diag" in kinds
    assert any(x["code"] == "LC_NO_RESP" for x in diag_msgs[0]["payload"]["diagnostics"])  # type: ignore[index]
    assert diag_msgs[-1]["payload"]["diagnostics"] == []  # type: ignore[index]
    f.close()
