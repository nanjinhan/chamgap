from __future__ import annotations

import json
import re

import pytest

from chamgap.protocol import (
    CommandError,
    LogLine,
    ParsedMessage,
    cmd_cal,
    cmd_flow,
    cmd_interval,
    cmd_pump,
    cmd_soilcal,
    cmd_water,
    command_name,
    parse_line,
    parse_web_command,
)

DATA = (
    '{"t":"data","node":"Z1","ms":20111,"seq":4,"sht_a_ok":1,"temp_a":23.40,"rh_a":45.10,'
    '"sht_b_ok":1,"temp_b":23.60,"rh_b":44.80,"soil_a_mv":2400,"soil_a":0.077,"soil_b_mv":1800,'
    '"soil_b":0.538,"hx_ok":1,"weight_g":500.0,"weight_sd":0.10,"v12":12.00,"leak":null,"pump":1,"rssi":-55}'
)
TS = 1_792_713_600.123


def test_data_line_parsed_with_pc_time_and_src() -> None:
    m = parse_line("COM5", DATA + "\r\n", TS)
    assert isinstance(m, ParsedMessage)
    assert m.t == "data" and m.node == "Z1" and not m.is_test
    assert m.data["seq"] == 4 and m.data["leak"] is None
    assert m.data["src"] == "COM5"
    # ISO 8601, ms까지, 시간대 포함 (COM-08)
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$", m.data["pc_time"])


def test_unknown_keys_are_kept() -> None:
    m = parse_line("COM5", '{"t":"data","node":"Z1","ms":1,"new_key":42,"nested":{"a":1}}', TS)
    assert isinstance(m, ParsedMessage)
    assert m.data["new_key"] == 42 and m.data["nested"] == {"a": 1}


def test_node_is_normalized_upper() -> None:
    m = parse_line("COM5", '{"t":"data","node":"z2","ms":1}', TS)
    assert isinstance(m, ParsedMessage) and m.node == "Z2"


def test_hash_line_is_note() -> None:
    m = parse_line("COM5", "# 토양 보정: 공기 중에 두세요", TS)
    assert isinstance(m, LogLine) and m.note and not m.bad_json


def test_boot_log_is_plain_log() -> None:
    m = parse_line("COM5", "rst:0x1 (POWERON_RESET),boot:0x13", TS)
    assert isinstance(m, LogLine) and not m.note and not m.bad_json


def test_broken_json_is_log() -> None:
    m = parse_line("COM5", '{"t":"data","node":"Z1"', TS)
    assert isinstance(m, LogLine) and m.bad_json


def test_json_without_t_is_log() -> None:
    m = parse_line("COM5", '{"node":"Z1"}', TS)
    assert isinstance(m, LogLine) and m.bad_json


def test_empty_line_is_none() -> None:
    assert parse_line("COM5", "\r\n", TS) is None


@pytest.mark.parametrize("t", ["i2c", "sht", "soil", "soilcal", "lc", "lccal", "pwr", "pump", "pumpcal", "evt"])
def test_message_without_node_is_test(t: str) -> None:
    m = parse_line("COM5", json.dumps({"t": t, "ms": 10, "x": 1}), TS)
    assert isinstance(m, ParsedMessage) and m.is_test and m.node is None


def test_command_builders() -> None:
    assert cmd_water(10) == "water 10"
    assert cmd_water(12.5) == "water 12.5"
    assert cmd_pump(2000) == "pump 2000"
    assert cmd_cal(500.0) == "cal 500"
    assert cmd_soilcal("a", "air") == "soilcal a air"
    assert cmd_flow(10000, 23.5) == "flow 10000 23.5"
    assert cmd_interval(2000) == "interval 2000"
    assert command_name("SoilCal a air") == "soilcal"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("tare", "tare"),
        ("INFO", "info"),
        ("cal 500", "cal 500"),
        ("soilcal A Air", "soilcal a air"),
        ("flow 10000 23.5", "flow 10000 23.5"),
        ("interval 2000", "interval 2000"),
        ("id Z2", "id z2"),
    ],
)
def test_web_command_allowed(text: str, expected: str) -> None:
    assert parse_web_command(text) == expected


@pytest.mark.parametrize(
    "text",
    ["pump 2000", "water 10", "stop", "format", "", "cal", "cal -3", "soilcal c air", "interval 100", "id 한글"],
)
def test_web_command_rejected(text: str) -> None:
    with pytest.raises(CommandError):
        parse_web_command(text)
