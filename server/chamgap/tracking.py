"""진단 규칙의 입력: 구역별 이력 링버퍼와 급수 추적.

- History: 최근 최대 6시간 측정값 + 사건(boot, refused, pump, mark, seq_gap...). 크기 제한 있음 (NFR-02).
- WaterTracker: 급수 직전 안정 무게 → pump_off(done) 뒤 2분 동안 안정 무게 → 증가량 판정.
  토양은 15분 동안 최대 상승량을 본다 (SOIL_NO_RISE).
"""

from __future__ import annotations

import statistics
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

KEEP_S = 6 * 3600.0
MIN_GAP_S = 2.0  # 이보다 촘촘한 값은 이력에 하나만 남긴다 (메모리 제한)
MAX_SAMPLES = int(KEEP_S / MIN_GAP_S) + 100

SAMPLE_KEYS = ("temp_a", "rh_a", "temp_b", "rh_b", "soil_a", "soil_b", "soil_a_mv", "soil_b_mv",
               "weight_g", "weight_sd", "v12")


@dataclass(slots=True)
class Sample:
    ts: float
    temp_a: float | None = None
    rh_a: float | None = None
    temp_b: float | None = None
    rh_b: float | None = None
    soil_a: float | None = None
    soil_b: float | None = None
    soil_a_mv: float | None = None
    soil_b_mv: float | None = None
    weight_g: float | None = None
    weight_sd: float | None = None
    v12: float | None = None

    def get(self, key: str) -> float | None:
        v: float | None = getattr(self, key)
        return v


def _f(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@dataclass(slots=True)
class NodeEvent:
    ts: float
    kind: str  # boot, seq_reset, seq_gap, refused, pump_on, pump_off, mark, cal
    info: dict[str, Any] = field(default_factory=dict)


class History:
    def __init__(self, keep_s: float = KEEP_S) -> None:
        self.keep_s = keep_s
        self.samples: deque[Sample] = deque(maxlen=MAX_SAMPLES)
        self.events: deque[NodeEvent] = deque(maxlen=2000)

    def add(self, ts: float, data: dict[str, Any]) -> None:
        s = Sample(ts, **{k: _f(data.get(k)) for k in SAMPLE_KEYS})
        if self.samples and ts - self.samples[-1].ts < MIN_GAP_S:
            self.samples[-1] = s  # 촘촘하면 마지막 것을 바꾼다
        else:
            self.samples.append(s)
        self._prune(ts)

    def add_event(self, ts: float, kind: str, **info: Any) -> None:
        self.events.append(NodeEvent(ts, kind, info))
        self._prune(ts)

    def _prune(self, now: float) -> None:
        cut = now - self.keep_s
        while self.samples and self.samples[0].ts < cut:
            self.samples.popleft()
        while self.events and self.events[0].ts < cut:
            self.events.popleft()

    def window(self, now: float, seconds: float) -> list[Sample]:
        cut = now - seconds
        return [s for s in self.samples if s.ts >= cut]

    def covers(self, now: float, seconds: float, slack: float = 30.0) -> bool:
        """seconds 동안의 이력이 있는가 (맨 앞 값이 그보다 오래됐는가)."""
        return bool(self.samples) and self.samples[0].ts <= now - seconds + slack

    def events_in(self, now: float, seconds: float, kinds: Iterable[str]) -> list[NodeEvent]:
        ks = set(kinds)
        cut = now - seconds
        return [e for e in self.events if e.ts >= cut and e.kind in ks]

    def last_event(self, kinds: Iterable[str]) -> NodeEvent | None:
        ks = set(kinds)
        for e in reversed(self.events):
            if e.kind in ks:
                return e
        return None


# ---------------------------------------------------------------- 급수 추적


@dataclass
class WaterParams:
    window_s: float = 120.0  # pump_off 뒤 무게를 보는 시간
    settle_s: float = 30.0  # 이보다 빨리 끝내지 않는다
    stable_sd_g: float = 3.0
    arrive_ratio: float = 0.5
    over_ratio: float = 1.5
    soil_window_s: float = 900.0
    soil_min_rise: float = 0.02

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> WaterParams:
        p = cls()
        for k, v in (d or {}).items():
            if hasattr(p, k):
                setattr(p, k, float(v))
        return p


@dataclass
class WaterRun:
    start_ts: float
    expected_ml: float | None
    before_g: float | None
    before_soil: dict[str, float | None]
    off_ts: float | None = None
    reason: str | None = None
    after: list[float] = field(default_factory=list)
    soil_max: dict[str, float | None] = field(default_factory=dict)
    # 결과
    verdict: str = "pending"  # pending | ok | not_arrived | over | unknown | skipped
    after_g: float | None = None
    delta_g: float | None = None
    result_ts: float | None = None
    soil_done: bool = False
    soil_verdict: dict[str, str] = field(default_factory=dict)  # 채널 → ok | no_rise | skipped
    soil_ts: float | None = None

    def soil_rise(self, ch: str) -> float | None:
        b, m = self.before_soil.get(ch), self.soil_max.get(ch)
        return None if b is None or m is None else m - b

    def to_result(self) -> dict[str, Any]:
        return {
            "expected_ml": self.expected_ml, "before_g": self.before_g, "after_g": self.after_g,
            "delta_g": self.delta_g, "verdict": self.verdict, "reason": self.reason,
        }


class WaterTracker:
    def __init__(self, params: WaterParams | None = None) -> None:
        self.p = params or WaterParams()
        self.current: WaterRun | None = None  # 펌프가 도는 중 또는 판정 대기
        self.last: WaterRun | None = None  # 무게 판정이 끝난 가장 최근 급수
        self.soil_runs: deque[WaterRun] = deque(maxlen=5)  # 토양 판정 대기·완료

    def on_pump_on(self, ts: float, ml: float | None, before_g: float | None,
                   before_soil: dict[str, float | None]) -> None:
        self.current = WaterRun(ts, ml, before_g, dict(before_soil))

    def on_pump_off(self, ts: float, reason: str | None) -> None:
        run = self.current
        if run is None:
            return
        run.off_ts, run.reason = ts, reason
        # 지시서: pump_off(done)이고 예상 mL가 있을 때만 판정 (유량 보정용 pump는 따로)
        if reason != "done" or run.expected_ml is None:
            run.verdict = "skipped"
            self.current = None

    def on_data(self, ts: float, data: dict[str, Any]) -> list[WaterRun]:
        """새 측정값. 판정이 끝난 급수를 돌려준다."""
        run = self.current
        if run is not None and run.off_ts is not None and ts >= run.off_ts:
            w, sd = _f(data.get("weight_g")), _f(data.get("weight_sd"))
            if w is not None and sd is not None and sd <= self.p.stable_sd_g:
                run.after.append(w)
        for r in [self.current, *self.soil_runs]:
            if r is None or r.off_ts is None or r.soil_done:
                continue
            for ch in ("a", "b"):
                v = _f(data.get(f"soil_{ch}"))
                if v is not None:
                    m = r.soil_max.get(ch)
                    r.soil_max[ch] = v if m is None else max(m, v)
        return self.tick(ts)

    def tick(self, now: float) -> list[WaterRun]:
        done: list[WaterRun] = []
        run = self.current
        if run is not None and run.off_ts is not None and self._finish_weight(run, now):
            run.result_ts = now
            self.last, self.current = run, None
            self.soil_runs.append(run)
            done.append(run)
        for r in self.soil_runs:
            if not r.soil_done and r.off_ts is not None:
                self._check_soil(r, now)
        return done

    def _finish_weight(self, run: WaterRun, now: float) -> bool:
        assert run.off_ts is not None and run.expected_ml is not None
        elapsed = now - run.off_ts
        exp = run.expected_ml
        last3 = run.after[-3:]
        after = statistics.median(last3) if last3 else None
        delta = None if after is None or run.before_g is None else after - run.before_g
        plateau = len(last3) == 3 and max(last3) - min(last3) <= 2.0
        in_range = delta is not None and self.p.arrive_ratio * exp <= delta <= self.p.over_ratio * exp
        if not ((elapsed >= self.p.settle_s and plateau and in_range) or elapsed >= self.p.window_s):
            return False
        run.after_g = None if after is None else round(after, 1)
        run.delta_g = None if delta is None else round(delta, 1)
        if delta is None:
            run.verdict = "unknown"
        elif delta < self.p.arrive_ratio * exp:
            run.verdict = "not_arrived"
        elif delta > self.p.over_ratio * exp:
            run.verdict = "over"
        else:
            run.verdict = "ok"
        return True

    def _check_soil(self, run: WaterRun, now: float) -> None:
        assert run.off_ts is not None
        arrived = run.verdict in ("ok", "over")
        if run.verdict not in ("pending", "ok", "over"):
            run.soil_done, run.soil_ts = True, now
            run.soil_verdict = {"a": "skipped", "b": "skipped"}
            return
        for ch in ("a", "b"):
            if ch in run.soil_verdict:
                continue
            rise = run.soil_rise(ch)
            if rise is not None and rise > self.p.soil_min_rise:
                run.soil_verdict[ch] = "ok"
            elif now - run.off_ts >= self.p.soil_window_s and run.verdict != "pending":
                run.soil_verdict[ch] = "no_rise" if (arrived and rise is not None) else "skipped"
        if len(run.soil_verdict) == 2:
            run.soil_done, run.soil_ts = True, now

    def last_soil(self, ch: str) -> WaterRun | None:
        """그 채널의 토양 판정이 끝난 가장 최근 급수."""
        for r in reversed(self.soil_runs):
            if ch in r.soil_verdict and r.soil_verdict[ch] != "skipped":
                return r
        return None
