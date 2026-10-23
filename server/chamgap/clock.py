"""시간 다루기. 테스트에서 시간을 건너뛸 수 있도록 Clock을 주입한다."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> float:
        """유닉스 시간(초)."""
        ...


class SystemClock:
    def now(self) -> float:
        return time.time()


class FakeClock:
    """테스트용 시계. advance()로 시간을 건너뛴다."""

    def __init__(self, start: float = 1_792_713_600.0) -> None:  # 2026-10-23 경
        self.t = start

    def now(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def iso_local(ts: float) -> str:
    """로컬 시간대 ISO 8601, ms까지 (예: 2026-10-23T16:51:02.123+09:00)."""
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="milliseconds")


def local_date(ts: float) -> str:
    """노트북 로컬 날짜 YYYY-MM-DD."""
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def parse_iso(text: str) -> float:
    """ISO 8601 문자열 또는 YYYY-MM-DD를 유닉스 시간으로. 시간대가 없으면 로컬."""
    dt = datetime.fromisoformat(text.strip())
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.timestamp()
