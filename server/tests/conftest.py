from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chamgap.clock import FakeClock
from chamgap.config import Config


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    c = Config()
    c.base_dir = tmp_path / "server"  # web_dist = tmp_path/web/dist (테스트마다 따로)
    return c
