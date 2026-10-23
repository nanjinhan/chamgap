"""진단 규칙: 규칙 하나 = 클래스 하나 (지시서 6.3절의 24개).

규칙은 '지금 조건이 맞는가'만 판단한다. 유지 시간·해제·억제는 engine이 한다.
detail_ko 안의 {elapsed}는 engine이 "10분째"처럼 바꿔 넣는다.
"""

from __future__ import annotations

import statistics
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from ..commands import REASON_KO
from ..state import NodeState
from ..tracking import History, WaterTracker
from .texts import SENSOR_NAMES, fmt_dur

Severity = Literal["info", "warn", "fault", "offline"]


@dataclass
class RuleResult:
    active: bool
    detail_ko: str = ""
    values: dict[str, Any] = field(default_factory=dict)
    variant: str | None = None  # 문구 변형 (예: SOIL_WIRE:low)


@dataclass
class RuleContext:
    node_id: str
    now: float
    node: NodeState
    history: History
    water: WaterTracker
    port_opened_ts: float | None = None

    @property
    def latest(self) -> dict[str, Any]:
        return self.node.latest or {}

    @property
    def info(self) -> dict[str, Any] | None:
        return self.node.info

    def num(self, key: str) -> float | None:
        v = self.latest.get(key)
        if v is None or isinstance(v, bool):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None


def _ch(sensor: str) -> str:
    return sensor.rsplit("_", 1)[-1]  # sht_a → a


def _signed(x: float, digits: int = 1) -> str:
    return f"{x:+.{digits}f}"


class Rule(ABC):
    code: ClassVar[str]
    severity: ClassVar[Severity]
    sensors: ClassVar[tuple[str, ...]]
    time_keys: ClassVar[tuple[str, ...]] = ("window_s",)  # mock 속도로 줄이는 시간 키
    eval_every_s: ClassVar[float] = 0.0  # 긴 창 규칙은 이 간격으로만 다시 계산 (CPU 절약)

    def __init__(self, sensor: str, params: dict[str, Any], scale: float = 1.0, min_clear_s: float = 10.0) -> None:
        self.sensor = sensor
        self.params = dict(params)
        self.scale = scale if scale > 0 else 1.0
        self.hold_s = float(params.get("hold_s", 0)) / self.scale
        if "clear_s" in params:
            self.clear_s = float(params["clear_s"]) / self.scale
        else:
            self.clear_s = max(self.hold_s, min_clear_s)

    @property
    def key(self) -> tuple[str, str]:
        return (self.code, self.sensor)

    def p(self, name: str, default: float) -> float:
        v = float(self.params.get(name, default))
        return v / self.scale if name in self.time_keys else v

    @abstractmethod
    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        """조건이 맞으면 active=True. 판단할 값이 없으면 None (= 조건 아님)."""

    def action(self, node: str) -> dict[str, str]:
        return {"label": "센서 보기", "to": f"/zone/{node}/sensor/{self.sensor}"}


# ================================================================ 구역


class NodeOffline(Rule):
    code, severity, sensors = "NODE_OFFLINE", "offline", ("node",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        n = ctx.node
        if n.mqtt_online is False:
            return RuleResult(True, "WiFi 연결이 끊겼어요 (브로커 알림)", {"reason": "mqtt"})
        last = n.last_data_ts or n.first_seen_ts or ctx.now
        gap = ctx.now - last
        limit = max(self.p("factor", 3) * n.sample_ms / 1000.0, self.p("min_s", 15))
        if gap < limit:
            return RuleResult(False)
        return RuleResult(True, f"마지막 값이 {fmt_dur(gap)} 전이에요 (기준 {limit:.0f}초)",
                          {"gap_s": round(gap, 1), "limit_s": limit})

    def action(self, node: str) -> dict[str, str]:
        return {"label": "구역 보기", "to": f"/zone/{node}"}


# TODO(확인 필요): evt boot의 reset 번호가 esp_reset_reason() 기준인지. 그렇다면 아래 뜻이다.
RESET_KO = {1: "전원 켜짐", 3: "소프트웨어 재시작", 4: "펌웨어 오류(panic)", 5: "워치독", 6: "워치독",
            7: "워치독", 9: "전원 부족(브라운아웃)"}


class NodeRebooted(Rule):
    code, severity, sensors = "NODE_REBOOTED", "info", ("node",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        show = self.p("show_s", 300)
        boots = ctx.history.events_in(ctx.now, show, ("boot", "seq_reset"))
        grace = self.p("ignore_after_open_s", 15)
        if ctx.port_opened_ts is not None:
            boots = [e for e in boots if not (0 <= e.ts - ctx.port_opened_ts <= grace)]
        boots = [e for e in boots if not e.info.get("expected")]
        if not boots:
            return RuleResult(False)
        e = boots[-1]
        reset = e.info.get("reset")
        parts = [f"{fmt_dur(ctx.now - e.ts)} 전에 재시작됨"]
        if reset is not None:
            parts.append(f"원인 번호 {reset}" + (f" · {RESET_KO[reset]}" if reset in RESET_KO else ""))
        if e.kind == "seq_reset":
            parts.append("순번(seq)이 1로 돌아감")
        pump = ctx.history.events_in(e.ts, 15, ("pump_on",))
        if any(p.ts <= e.ts for p in pump):
            parts.append("펌프를 켠 직후예요")
        return RuleResult(True, " · ".join(parts), {"count": len(boots), "reset": reset})

    def action(self, node: str) -> dict[str, str]:
        return {"label": "구역 보기", "to": f"/zone/{node}"}


class MsgGap(Rule):
    code, severity, sensors = "MSG_GAP", "warn", ("node",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        win = self.p("window_s", 600)
        gaps = ctx.history.events_in(ctx.now, win, ("seq_gap",))
        need = int(self.p("count", 3))
        if len(gaps) < need:
            return RuleResult(False)
        missed = sum(int(g.info.get("missed", 1)) for g in gaps)
        detail = f"{fmt_dur(win)} 동안 {len(gaps)}번 끊김 (빠진 값 {missed}개, 기준 {need}번)"
        rssi = ctx.num("rssi")
        if rssi is not None and rssi < self.p("weak_rssi", -75):
            detail += f" · WiFi 약함 {rssi:.0f}dBm"
        return RuleResult(True, detail, {"gaps": len(gaps), "missed": missed, "rssi": rssi})

    def action(self, node: str) -> dict[str, str]:
        return {"label": "구역 보기", "to": f"/zone/{node}"}


# ================================================================ 온습도


class ShtNoResp(Rule):
    code, severity, sensors = "SHT_NO_RESP", "fault", ("sht_a", "sht_b")

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        ok = ctx.latest.get(f"sht_{_ch(self.sensor)}_ok")
        if ok is None:
            return None
        if ok in (1, True):
            return RuleResult(False)
        return RuleResult(True, f"{SENSOR_NAMES[self.sensor]}가 읽히지 않아요 ({{elapsed}})")


class ShtRange(Rule):
    code, severity, sensors = "SHT_RANGE", "fault", ("sht_a", "sht_b")

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        c = _ch(self.sensor)
        t, rh = ctx.num(f"temp_{c}"), ctx.num(f"rh_{c}")
        if t is None and rh is None:
            return None
        tmin, tmax = self.p("temp_min", -10), self.p("temp_max", 60)
        hmin, hmax = self.p("rh_min", 0), self.p("rh_max", 100)
        bad: list[str] = []
        if t is not None and not tmin <= t <= tmax:
            bad.append(f"온도 {t:.1f}°C (허용 {tmin:.0f}~{tmax:.0f}°C)")
        if rh is not None and not hmin <= rh <= hmax:
            bad.append(f"습도 {rh:.1f}% (허용 {hmin:.0f}~{hmax:.0f}%)")
        return RuleResult(bool(bad), " · ".join(bad), {"temp": t, "rh": rh})


class ShtAbDiff(Rule):
    code, severity, sensors = "SHT_AB_DIFF", "warn", ("sht_b",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        ta, tb, ha, hb = ctx.num("temp_a"), ctx.num("temp_b"), ctx.num("rh_a"), ctx.num("rh_b")
        if None in (ta, tb, ha, hb):
            return None
        assert ta is not None and tb is not None and ha is not None and hb is not None
        dt, dh = tb - ta, hb - ha
        lt, lh = self.p("temp_diff", 1.0), self.p("rh_diff", 5.0)
        parts: list[str] = []
        if abs(dt) > lt:
            parts.append(f"B가 A보다 {abs(dt):.1f}°C {'높음' if dt > 0 else '낮음'} (기준 {lt:.1f}°C)")
        if abs(dh) > lh:
            parts.append(f"습도 B가 A보다 {abs(dh):.1f}% {'높음' if dh > 0 else '낮음'} (기준 {lh:.0f}%)")
        detail = " · ".join(parts) + (" · {elapsed}" if parts else "")
        return RuleResult(bool(parts), detail,
                          {"d_temp": round(dt, 2), "d_rh": round(dh, 2), "temp_diff": lt, "rh_diff": lh})


class ShtStuck(Rule):
    code, severity, sensors = "SHT_STUCK", "warn", ("sht_a", "sht_b")
    eval_every_s = 30.0

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        win = self.p("window_s", 1800)
        if not ctx.history.covers(ctx.now, win):
            return None
        c = _ch(self.sensor)
        rows = ctx.history.window(ctx.now, win)
        ts = [s.get(f"temp_{c}") for s in rows]
        hs = [s.get(f"rh_{c}") for s in rows]
        t_vals = [v for v in ts if v is not None]
        h_vals = [v for v in hs if v is not None]
        if len(t_vals) < 5 or len(h_vals) < 5:
            return None
        lim = self.p("max_change", 0.02)
        stuck = max(t_vals) - min(t_vals) <= lim and max(h_vals) - min(h_vals) <= lim
        return RuleResult(stuck, f"{fmt_dur(win)} 동안 {t_vals[-1]:.2f}°C · {h_vals[-1]:.1f}%에서 움직이지 않아요",
                          {"window_s": win})


# ================================================================ 토양


class SoilWire(Rule):
    code, severity, sensors = "SOIL_WIRE", "fault", ("soil_a", "soil_b")

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        mv = ctx.num(f"soil_{_ch(self.sensor)}_mv")
        if mv is None:
            return None
        lo, hi = self.p("mv_low", 150), self.p("mv_high", 3050)
        if mv < lo:
            return RuleResult(True, f"{mv:.0f}mV — 너무 낮아요 (정상 {lo:.0f}~{hi:.0f}mV)", {"mv": mv}, "low")
        if mv > hi:
            return RuleResult(True, f"{mv:.0f}mV — 너무 높아요 (정상 {lo:.0f}~{hi:.0f}mV)", {"mv": mv}, "high")
        return RuleResult(False)


class SoilUncal(Rule):
    code, severity, sensors = "SOIL_UNCAL", "info", ("soil_a", "soil_b")

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        info = ctx.info
        if info is None:
            return None
        c = _ch(self.sensor)
        # TODO(확인 필요): info의 soil_cal이 A·B 공통 하나인지. 채널별 키(soil_a_cal)가 오면 그것을 쓴다.
        flag = info.get(f"soil_{c}_cal", info.get("soil_cal"))
        air, wet = info.get(f"soil_{c}_air"), info.get(f"soil_{c}_wet")
        if flag in (0, False):
            return RuleResult(True, f"보정값이 없어 기본값(공기 {air} / 물 {wet}mV)으로 계산 중이에요",
                              {"air": air, "wet": wet})
        if isinstance(air, int | float) and isinstance(wet, int | float) and air - wet < 100:
            return RuleResult(True, f"보정값이 이상해요 (공기 {air} / 물 {wet}mV, 차이가 너무 작음)",
                              {"air": air, "wet": wet})
        return RuleResult(False)

    def action(self, node: str) -> dict[str, str]:
        return {"label": "보정하기", "to": f"/calibrate/{node}/soil"}


class SoilAbDiff(Rule):
    code, severity, sensors = "SOIL_AB_DIFF", "warn", ("soil_b",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        a, b = ctx.num("soil_a"), ctx.num("soil_b")
        if a is None or b is None:
            return None
        lim = self.p("max_diff", 0.25)
        d = b - a
        return RuleResult(abs(d) > lim, f"B가 A보다 {abs(d):.2f} {'높음' if d > 0 else '낮음'} (기준 {lim:.2f}, {{elapsed}})",
                          {"diff": round(d, 3), "max_diff": lim})


class SoilNoRise(Rule):
    code, severity, sensors = "SOIL_NO_RISE", "warn", ("soil_a", "soil_b")

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        c = _ch(self.sensor)
        run = ctx.water.last_soil(c)
        if run is None or run.soil_ts is None or ctx.now - run.soil_ts > self.p("show_s", 3600):
            return RuleResult(False)
        if run.soil_verdict.get(c) != "no_rise":
            return RuleResult(False)
        rise = run.soil_rise(c) or 0.0
        return RuleResult(
            True,
            f"급수 뒤 무게는 {_signed(run.delta_g or 0)}g 늘었는데 수분은 {_signed(rise, 2)}만 올랐어요 "
            f"(기준 +{ctx.water.p.soil_min_rise:.2f}, {fmt_dur(ctx.water.p.soil_window_s)} 안)",
            {"rise": round(rise, 3), "delta_g": run.delta_g},
        )


class SoilStuck(Rule):
    code, severity, sensors = "SOIL_STUCK", "info", ("soil_a", "soil_b")
    eval_every_s = 30.0

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        win = self.p("window_s", 21600)
        if not ctx.history.covers(ctx.now, win):
            return None
        vals = [v for s in ctx.history.window(ctx.now, win) if (v := s.get(f"soil_{_ch(self.sensor)}_mv")) is not None]
        if len(vals) < 5:
            return None
        lim = self.p("max_change_mv", 10)
        span = max(vals) - min(vals)
        return RuleResult(span <= lim, f"{fmt_dur(win)} 동안 {statistics.median(vals):.0f}mV 근처에서 거의 그대로예요 "
                          f"(변화 {span:.0f}mV, 기준 {lim:.0f}mV)", {"span_mv": span})


# ================================================================ 무게


class LcNoResp(Rule):
    code, severity, sensors = "LC_NO_RESP", "fault", ("scale",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        ok = ctx.latest.get("hx_ok")
        if ok is None:
            return None
        return RuleResult(ok in (0, False), "HX711이 1초 넘게 응답하지 않아요 ({elapsed})")


class LcUncal(Rule):
    code, severity, sensors = "LC_UNCAL", "info", ("scale",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        info = ctx.info
        if info is not None and info.get("lc_cal") in (0, False):
            return RuleResult(True, "영점·배율 보정값이 없어요")
        if ctx.latest.get("hx_ok") in (1, True) and "weight_g" in ctx.latest and ctx.latest["weight_g"] is None:
            return RuleResult(True, "HX711은 응답하지만 무게를 계산할 보정값이 없어요")
        return RuleResult(False) if info is not None or ctx.latest else None

    def action(self, node: str) -> dict[str, str]:
        return {"label": "보정하기", "to": f"/calibrate/{node}/scale"}


class LcNoisy(Rule):
    code, severity, sensors = "LC_NOISY", "warn", ("scale",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        sd = ctx.num("weight_sd")
        if sd is None:
            return None
        lim = self.p("max_sd_g", 5)
        return RuleResult(sd > lim, f"흔들림 ±{sd:.1f}g (기준 {lim:.0f}g, {{elapsed}})", {"sd": sd, "max_sd_g": lim})


class LcNegative(Rule):
    code, severity, sensors = "LC_NEGATIVE", "warn", ("scale",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        w = ctx.num("weight_g")
        if w is None:
            return None
        lim = self.p("min_g", -50)
        return RuleResult(w < lim, f"{w:,.1f}g (기준 {lim:.0f}g보다 커야 함)", {"weight_g": w})

    def action(self, node: str) -> dict[str, str]:
        return {"label": "영점 다시 잡기", "to": f"/calibrate/{node}/scale"}


class LcOverload(Rule):
    code, severity, sensors = "LC_OVERLOAD", "fault", ("scale",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        w = ctx.num("weight_g")
        if w is None:
            return None
        lim = self.p("max_g", 7000)
        return RuleResult(w > lim, f"{w:,.0f}g (운용 한도 {lim:,.0f}g)", {"weight_g": w})


class LcDriftUp(Rule):
    code, severity, sensors = "LC_DRIFT_UP", "warn", ("scale",)
    eval_every_s = 30.0

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        win = self.p("window_s", 3600)
        if not ctx.history.covers(ctx.now, win):
            return None
        if ctx.history.events_in(ctx.now, win, ("pump_on", "pump_off", "mark", "cal", "boot")):
            return RuleResult(False)
        stable = [s.weight_g for s in ctx.history.window(ctx.now, win)
                  if s.weight_g is not None and s.weight_sd is not None and s.weight_sd <= 3.0]
        if len(stable) < 6:
            return None
        start, end = statistics.median(stable[:3]), statistics.median(stable[-3:])
        rise = end - start
        lim = self.p("rise_g", 20)
        return RuleResult(rise >= lim, f"급수·메모 없이 {fmt_dur(win)}에 {_signed(rise)}g 늘었어요 (기준 +{lim:.0f}g)",
                          {"rise_g": round(rise, 1)})


# ================================================================ 펌프


class WaterNotArrived(Rule):
    code, severity, sensors = "WATER_NOT_ARRIVED", "fault", ("pump",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        run = ctx.water.last
        if run is None or run.verdict != "not_arrived" or run.result_ts is None:
            return RuleResult(False)
        if ctx.now - run.result_ts > self.p("show_s", 3600):
            return RuleResult(False)
        exp = run.expected_ml or 0
        need = exp * ctx.water.p.arrive_ratio
        return RuleResult(
            True,
            f"{exp:.0f}mL 줬는데 {fmt_dur(ctx.water.p.window_s)} 동안 {_signed(run.delta_g or 0)}g만 늘었어요 "
            f"(기준 {ctx.water.p.arrive_ratio:.0%} = {need:.0f}g)",
            {"expected_ml": exp, "delta_g": run.delta_g},
        )

    def action(self, node: str) -> dict[str, str]:
        return {"label": "급수 화면", "to": f"/water/{node}"}


class WaterOver(Rule):
    code, severity, sensors = "WATER_OVER", "warn", ("pump",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        run = ctx.water.last
        if run is None or run.verdict != "over" or run.result_ts is None:
            return RuleResult(False)
        if ctx.now - run.result_ts > self.p("show_s", 3600):
            return RuleResult(False)
        exp = run.expected_ml or 0
        lim = exp * ctx.water.p.over_ratio
        return RuleResult(True, f"{exp:.0f}mL 줬는데 {_signed(run.delta_g or 0)}g 늘었어요 "
                          f"(기준 {ctx.water.p.over_ratio:.0%} = {lim:.0f}g)",
                          {"expected_ml": exp, "delta_g": run.delta_g})

    def action(self, node: str) -> dict[str, str]:
        return {"label": "유량 다시 보정", "to": f"/calibrate/{node}/flow"}


class PumpRefused(Rule):
    code, severity, sensors = "PUMP_REFUSED", "warn", ("pump",)

    def evaluate(self, ctx: RuleContext) -> RuleResult:
        evs = ctx.history.events_in(ctx.now, self.p("show_s", 120), ("refused",))
        if not evs:
            return RuleResult(False)
        reason = str(evs[-1].info.get("reason") or "")
        return RuleResult(True, f"{REASON_KO.get(reason, reason)} ({fmt_dur(ctx.now - evs[-1].ts)} 전)",
                          {"reason": reason}, reason or None)

    def action(self, node: str) -> dict[str, str]:
        return {"label": "급수 화면", "to": f"/water/{node}"}


class FlowUncal(Rule):
    code, severity, sensors = "FLOW_UNCAL", "info", ("pump",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        if ctx.info is None:
            return None
        mlps = ctx.info.get("pump_mlps")
        try:
            uncal = mlps is not None and float(mlps) <= 0
        except (TypeError, ValueError):
            uncal = False
        return RuleResult(uncal, "유량(mL/s)을 몰라서 mL로 급수할 수 없어요")

    def action(self, node: str) -> dict[str, str]:
        return {"label": "보정하기", "to": f"/calibrate/{node}/flow"}


# ================================================================ 전원


class V12Missing(Rule):
    code, severity, sensors = "V12_MISSING", "warn", ("power",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        v = ctx.num("v12")
        if v is None:
            return None
        lim = self.p("min_v", 9.0)
        return RuleResult(v < lim, f"12V가 {v:.1f}V예요 (기준 {lim:.1f}V 이상)", {"v12": v})


class Leak(Rule):
    code, severity, sensors = "LEAK", "fault", ("power",)

    def evaluate(self, ctx: RuleContext) -> RuleResult | None:
        leak = ctx.latest.get("leak")
        if leak is None:
            return None
        return RuleResult(leak in (1, True), "누수 센서에 물이 닿았어요")


RULE_CLASSES: tuple[type[Rule], ...] = (
    NodeOffline, NodeRebooted, MsgGap,
    ShtNoResp, ShtRange, ShtAbDiff, ShtStuck,
    SoilWire, SoilUncal, SoilAbDiff, SoilNoRise, SoilStuck,
    LcNoResp, LcUncal, LcNoisy, LcNegative, LcOverload, LcDriftUp,
    WaterNotArrived, WaterOver, PumpRefused, FlowUncal,
    V12Missing, Leak,
)
assert len(RULE_CLASSES) == 24
