from __future__ import annotations

import pytest

from chamgap.config import SafetyCfg
from chamgap.safety import flow_cal_preflight, water_preflight
from chamgap.state import NodeState


def ready_node() -> NodeState:
    n = NodeState("Z1")
    n.online = True
    n.info = {"pump_mlps": 2.35}
    n.pump.today_ml = 30.0
    return n


CFG = SafetyCfg()


def test_all_pass() -> None:
    pf = water_preflight("Z1", ready_node(), 10, set(), CFG)
    assert pf.ok and pf.first_fail is None
    assert [c.key for c in pf.checks] == [
        "offline", "pump_on", "bad_ml", "daily_limit", "flow_uncal", "leak", "no_12v", "scale_dead"
    ]


def test_unknown_node_is_offline() -> None:
    pf = water_preflight("Z1", None, 10, set(), CFG)
    assert pf.first_fail is not None and pf.first_fail.key == "offline"
    assert pf.first_fail.detail_ko == "Z1이 연결되어 있지 않아요"


@pytest.mark.parametrize("ml", [0, -5, 50.5, 100])
def test_bad_ml(ml: float) -> None:
    pf = water_preflight("Z1", ready_node(), ml, set(), CFG)
    assert pf.first_fail is not None and pf.first_fail.key == "bad_ml"


def test_daily_limit_message_has_current_amount() -> None:
    n = ready_node()
    n.pump.today_ml = 280
    pf = water_preflight("Z1", n, 30, set(), CFG)
    assert pf.first_fail is not None and pf.first_fail.key == "daily_limit"
    assert pf.first_fail.detail_ko == "오늘 급수 한도(300mL)를 넘어요 (지금 280mL)"
    assert water_preflight("Z1", n, 20, set(), CFG).ok  # 정확히 300은 통과


def test_flow_uncal_blocks_water() -> None:
    n = ready_node()
    n.info = {"pump_mlps": 0.0}
    pf = water_preflight("Z1", n, 10, set(), CFG)
    assert pf.first_fail is not None and pf.first_fail.key == "flow_uncal"


@pytest.mark.parametrize(("code", "key"), [("LEAK", "leak"), ("V12_MISSING", "no_12v"), ("LC_NO_RESP", "scale_dead")])
def test_active_diagnostic_blocks(code: str, key: str) -> None:
    pf = water_preflight("Z1", ready_node(), 10, {code}, CFG)
    assert pf.first_fail is not None and pf.first_fail.key == key


def test_order_first_failure_wins() -> None:
    n = ready_node()
    n.pump.on = True
    n.info = {"pump_mlps": 0}
    pf = water_preflight("Z1", n, 10, {"LEAK"}, CFG)
    assert pf.first_fail is not None and pf.first_fail.key == "pump_on"
    assert [c.key for c in pf.checks if not c.ok] == ["pump_on", "flow_uncal", "leak"]


def test_limits_from_config() -> None:
    pf = water_preflight("Z1", ready_node(), 25, set(), SafetyCfg(max_ml_per_shot=20))
    assert pf.first_fail is not None and pf.first_fail.key == "bad_ml"


def test_flow_cal_ignores_flow_and_scale_checks() -> None:
    n = ready_node()
    n.info = {"pump_mlps": 0}
    assert flow_cal_preflight("Z1", n, 10000, {"LC_NO_RESP"}).ok
    assert not flow_cal_preflight("Z1", n, 10000, {"V12_MISSING"}).ok
    assert flow_cal_preflight("Z1", n, 20000, set()).first_fail.key == "bad_ms"  # type: ignore[union-attr]
