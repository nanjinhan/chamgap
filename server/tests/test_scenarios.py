"""검수 기준 (지시서 6.4): mock 시나리오를 켜면 6.3절의 해당 진단이 실제로 뜬다."""

from __future__ import annotations

from pathlib import Path

import pytest

from chamgap.links.mock_link import SCENARIO_EXPECTS, SCENARIOS

from .sim import Sim

# 시나리오 → (켠 뒤 기다릴 초, 급수 여부)
PLAN: dict[str, tuple[int, bool]] = {
    "offline": (30, False),
    "sht_b_dead": (30, False),
    "sht_b_hot": (11 * 60, False),
    "soil_a_unplugged": (30, False),
    "soil_ab_diff": (11 * 60, False),
    "lc_dead": (30, False),
    "lc_noisy": (3 * 60, False),
    "estop_pressed": (10, False),
    "water_clog": (150, True),
    "leak": (10, False),
}


def test_every_scenario_has_a_plan() -> None:
    assert set(PLAN) | {"normal"} == set(SCENARIOS)


def test_normal_has_no_diagnostics(tmp_path: Path) -> None:
    sim = Sim(tmp_path)
    sim.run(5 * 60)
    assert sim.codes() == set()
    assert sim.hub.nodes["Z1"].status() == "ok"
    sim.close()


@pytest.mark.parametrize("scenario", list(PLAN))
def test_scenario_raises_expected_diagnostic(tmp_path: Path, scenario: str) -> None:
    sim = Sim(tmp_path)
    sim.run(30)
    assert sim.codes() == set()
    sim.scenario("Z1", scenario)
    wait, water = PLAN[scenario]
    if water:
        sim.cmd("Z1", "water 10")
    sim.run(wait)
    expected = set(SCENARIO_EXPECTS[scenario])
    assert expected <= sim.codes(), f"{scenario}: {sim.codes()}"
    # 되돌리면 풀린다 (유지 시간 뒤)
    sim.scenario("Z1", "normal")
    sim.run(12 * 60)
    assert not ({"NODE_OFFLINE", "SHT_NO_RESP", "SOIL_WIRE", "LC_NO_RESP", "V12_MISSING", "LEAK"} & sim.codes())
    sim.close()


def test_estop_refusal_shows_cause_only(tmp_path: Path) -> None:
    sim = Sim(tmp_path)
    sim.run(20)
    sim.scenario("Z1", "estop_pressed")
    sim.run(10)
    sim.cmd("Z1", "water 10")  # ESP32가 no_12v로 거부
    sim.run(5)
    assert "V12_MISSING" in sim.codes() and "PUMP_REFUSED" not in sim.codes()
    assert "PUMP_REFUSED" in sim.hub.active_codes("Z1")  # 숨겼을 뿐 기록은 있음
    sim.close()


def test_normal_watering_is_ok_and_soil_rises(tmp_path: Path) -> None:
    sim = Sim(tmp_path)
    sim.run(30)
    sim.cmd("Z1", "water 10")
    sim.run(16 * 60)
    run = sim.hub.waters["Z1"].last
    assert run is not None and run.verdict == "ok" and 8 <= (run.delta_g or 0) <= 11
    assert run.soil_verdict == {"a": "ok", "b": "ok"}
    assert not {"WATER_NOT_ARRIVED", "WATER_OVER", "SOIL_NO_RISE"} & sim.codes()
    sim.close()


def test_z3_starts_flow_uncalibrated(tmp_path: Path) -> None:
    sim = Sim(tmp_path, nodes=("Z1", "Z3"))
    sim.run(10)
    assert sim.codes("Z3") == {"FLOW_UNCAL"} and sim.hub.nodes["Z3"].status() == "info"
    pf = sim.hub.preflight("Z3", 10)
    assert pf.first_fail is not None and pf.first_fail.key == "flow_uncal"
    sim.close()
