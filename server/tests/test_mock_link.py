"""mock 노드: 시간을 건너뛰며 펌웨어와 같은 응답·물리 흉내를 시험한다."""

from __future__ import annotations

import json
import random
from typing import Any

import pytest

from chamgap.links.mock_link import SCENARIOS, MockNode

T0 = 1_792_713_600.0


def msgs(lines: list[str]) -> list[dict[str, Any]]:
    return [json.loads(x) for x in lines if x.startswith("{")]


def node(key: str = "Z1", speed: float = 1.0) -> MockNode:
    return MockNode(key, speed, T0, random.Random(1))


def run_until(mn: MockNode, t_end: float, step: float = 0.1, t: float = T0) -> tuple[float, list[dict[str, Any]]]:
    out: list[dict[str, Any]] = []
    while t < t_end:
        t += step
        out += msgs(mn.poll(t))
    return t, out


def datas(ms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [m for m in ms if m["t"] == "data"]


def test_boot_sends_boot_and_info() -> None:
    ms = msgs(node().boot_lines(T0))
    assert [m["t"] for m in ms] == ["evt", "info"]
    assert ms[0]["ev"] == "boot" and ms[1]["sample_ms"] == 5000 and ms[1]["pump_mlps"] == 2.35


def test_data_every_sample_ms_with_all_keys() -> None:
    mn = node()
    _, ms = run_until(mn, T0 + 30)
    d = datas(ms)
    assert len(d) == 6 and [x["seq"] for x in d] == [1, 2, 3, 4, 5, 6]
    keys = {"seq", "sht_a_ok", "temp_a", "rh_a", "sht_b_ok", "temp_b", "rh_b", "soil_a_mv", "soil_a",
            "soil_b_mv", "soil_b", "hx_ok", "weight_g", "weight_sd", "v12", "leak", "pump", "rssi"}
    assert keys <= set(d[0])
    assert 20 < d[0]["temp_a"] < 26 and 1100 < d[0]["weight_g"] < 1300 and 0.3 <= d[0]["weight_sd"] <= 0.8
    assert d[0]["leak"] is None  # 누수 센서 없음


def test_mock_speed_5_sends_every_second() -> None:
    _, ms = run_until(node(speed=5), T0 + 10)
    assert 9 <= len(datas(ms)) <= 10


def test_water_runs_pump_and_weight_rises() -> None:
    mn = node()
    t, ms = run_until(mn, T0 + 20)
    before = datas(ms)[-1]["weight_g"]
    out = msgs(mn.handle("water 10", t))
    assert out[0]["ev"] == "pump_on" and out[0]["ml"] == 10.0 and out[0]["dur"] == round(10 / 2.35 * 1000)
    assert out[1] == {**out[1], "t": "ack", "cmd": "water", "ok": 1}
    t, ms = run_until(mn, t + 30, t=t)
    off = [m for m in ms if m.get("ev") == "pump_off"]
    assert len(off) == 1 and off[0]["reason"] == "done" and off[0]["ran"] == off[0]["dur"]
    after = datas(ms)[-1]["weight_g"]
    assert 8.0 < after - before < 11.5


def test_water_before_flow_cal_is_refused() -> None:
    mn = node("Z3")
    out = msgs(mn.handle("water 10", T0 + 1))
    assert out == [{**out[0], "t": "ack", "cmd": "water", "ok": 0, "msg": "flow_uncal"}]


@pytest.mark.parametrize(
    ("setup", "cmd", "reason"),
    [
        ("none", "pump 20000", "bad_ms"),
        ("none", "pump 10", "bad_ms"),
        ("running", "pump 1000", "already_on"),
        ("cooldown", "pump 1000", "cooldown"),
        ("estop_pressed", "pump 1000", "no_12v"),
        ("leak", "water 10", "leak"),
    ],
)
def test_pump_refusals(setup: str, cmd: str, reason: str) -> None:
    mn = node()
    t = T0 + 10
    if setup == "running":
        mn.handle("pump 5000", t)
    elif setup == "cooldown":
        mn.handle("pump 100", t)
        mn.poll(t + 0.2)
        t += 1.0
    elif setup in SCENARIOS:
        mn.set_scenario(setup, t)
    out = msgs(mn.handle(cmd, t))
    assert out[0]["ev"] == "refused" and out[0]["reason"] == reason
    assert out[1]["t"] == "ack" and out[1]["ok"] == 0 and out[1]["msg"] == reason


def test_stop_and_estop_turn_pump_off() -> None:
    mn = node()
    mn.handle("pump 5000", T0 + 1)
    out = msgs(mn.handle("stop", T0 + 2))
    assert out[0]["ev"] == "pump_off" and out[0]["reason"] == "stop" and out[0]["ran"] == 1000
    mn.handle("pump 5000", T0 + 10)
    mn.set_scenario("estop_pressed", T0 + 11)
    out = msgs(mn.poll(T0 + 11.1))
    assert any(m.get("ev") == "pump_off" and m["reason"] == "no_12v" for m in out)


def test_tare_ack_after_2s_then_cal() -> None:
    mn = node()
    assert msgs(mn.handle("cal 500", T0 + 1))[0]["msg"] == "tare first"
    assert mn.handle("tare", T0 + 2) == []
    assert msgs(mn.poll(T0 + 3.0)) == [] or all(m["t"] != "ack" for m in msgs(mn.poll(T0 + 3.0)))
    acks = [m for m in msgs(mn.poll(T0 + 4.1)) if m["t"] == "ack"]
    assert acks and acks[0]["cmd"] == "tare" and acks[0]["ok"] == 1
    d = msgs([mn.make_data(T0 + 5)])[0]
    assert abs(d["weight_g"]) < 3  # 빈 판
    mn.handle("cal 500", T0 + 6)
    acks = [m for m in msgs(mn.poll(T0 + 8)) if m["t"] == "ack"]
    assert acks[0]["cmd"] == "cal" and acks[0]["ok"] == 1
    d = msgs([mn.make_data(T0 + 9)])[0]
    assert abs(d["weight_g"] - 500) < 3  # 아는 무게


def test_soilcal_flow_interval_update_info() -> None:
    mn = node("Z3")
    assert msgs(mn.handle("soilcal a air", T0))[0]["ok"] == 1
    assert msgs(mn.handle("flow 10000 22", T0))[0]["ok"] == 1
    assert msgs(mn.handle("interval 2000", T0))[0]["ok"] == 1
    info = msgs([mn.info_line(T0)])[0]
    assert info["pump_mlps"] == 2.2 and info["sample_ms"] == 2000 and 2470 <= info["soil_a_air"] <= 2490


def test_reboot_restarts_seq_and_applies_id() -> None:
    mn = node()
    t, _ = run_until(mn, T0 + 12)
    mn.handle("id z5", t)
    mn.handle("reboot", t)
    t, ms = run_until(mn, t + 8, t=t)
    assert ms[0]["ev"] == "boot" and ms[0]["node"] == "Z5"
    assert datas(ms)[0]["seq"] == 1


@pytest.mark.parametrize(
    ("scenario", "check"),
    [
        ("sht_b_dead", lambda d: d["sht_b_ok"] == 0 and d["temp_b"] is None and d["rh_b"] is None),
        ("sht_b_hot", lambda d: d["temp_b"] - d["temp_a"] > 2.5),
        ("soil_a_unplugged", lambda d: 5 <= d["soil_a_mv"] <= 20 and d["soil_a"] is None),
        ("soil_ab_diff", lambda d: d["soil_a"] - d["soil_b"] > 0.3),
        ("lc_dead", lambda d: d["hx_ok"] == 0 and d["weight_g"] is None),
        ("lc_noisy", lambda d: 8 <= d["weight_sd"] <= 12),
        ("estop_pressed", lambda d: d["v12"] == 0.0),
        ("leak", lambda d: d["leak"] == 1),
    ],
)
def test_scenarios_change_data(scenario: str, check: Any) -> None:
    mn = node()
    mn.set_scenario(scenario, T0)
    d = msgs([mn.make_data(T0 + 1)])[0]
    assert check(d)


def test_offline_stops_messages_and_normal_resumes() -> None:
    mn = node()
    mn.set_scenario("offline", T0)
    _, ms = run_until(mn, T0 + 20)
    assert ms == [] and mn.handle("info", T0 + 20) == []
    mn.set_scenario("normal", T0 + 20)
    _, ms = run_until(mn, T0 + 26, t=T0 + 20)
    assert datas(ms)


def test_water_clog_pump_runs_but_no_weight() -> None:
    mn = node()
    t, ms = run_until(mn, T0 + 20)
    before = datas(ms)[-1]["weight_g"]
    mn.set_scenario("water_clog", t)
    assert msgs(mn.handle("water 10", t))[0]["ev"] == "pump_on"
    t, ms = run_until(mn, t + 30, t=t)
    assert any(m.get("ev") == "pump_off" for m in ms)
    assert abs(datas(ms)[-1]["weight_g"] - before) < 3


def test_leak_scenario_announces_leak_sensor_in_info() -> None:
    out = msgs(node().set_scenario("leak", T0))
    assert out[0]["t"] == "info" and out[0]["leak_sensor"] == 1
