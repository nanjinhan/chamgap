"""README의 mock 시나리오 표가 코드(검수 기준)와 같은지."""

from __future__ import annotations

import re
from pathlib import Path

from chamgap.links.mock_link import SCENARIO_EXPECTS

README = Path(__file__).resolve().parent.parent / "README.md"


def test_readme_scenario_table_matches_code() -> None:
    rows: dict[str, set[str]] = {}
    for line in README.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| `([a-z_0-9]+)` \|.*\| (.+) \|$", line)
        if m and m.group(1) in SCENARIO_EXPECTS:
            rows[m.group(1)] = set(re.findall(r"`([A-Z0-9_]+)`", m.group(2)))
    assert set(rows) == set(SCENARIO_EXPECTS)
    for name, codes in SCENARIO_EXPECTS.items():
        assert rows[name] == set(codes), name
