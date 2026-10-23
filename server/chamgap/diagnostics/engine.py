"""진단 엔진: 규칙 실행, 유지 시간(DX-02), 억제(DX-06).

규칙마다 inactive → pending → active → clearing → inactive 상태 기계를 돌린다.
- pending: 조건이 맞기 시작함. hold_s만큼 이어지면 active.
- clearing: 조건이 풀림. clear_s만큼 정상이 이어지면 inactive (그동안은 계속 보인다).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..clock import iso_local
from ..state import SEVERITY_ORDER
from ..tracking import WaterParams
from .rules import RULE_CLASSES, Rule, RuleContext, RuleResult
from .texts import fmt_dur, text_for

log = logging.getLogger("chamgap.diag")


@dataclass
class _Track:
    state: str = "inactive"  # inactive | pending | active | clearing
    cond_since: float | None = None  # 조건이 처음 맞은 시각
    since: float | None = None  # active가 된 시각
    clear_since: float | None = None
    result: RuleResult | None = None
    last_eval: float = -1e18
    last_res: RuleResult | None = None


@dataclass
class EvalOutcome:
    turned_on: list[dict[str, Any]] = field(default_factory=list)
    turned_off: list[dict[str, Any]] = field(default_factory=list)
    visible: list[dict[str, Any]] = field(default_factory=list)
    visible_changed: bool = False  # 보이는 진단의 코드·단계·since가 바뀜
    detail_changed: bool = False  # 숫자·문구만 바뀜


def _sig(diags: list[dict[str, Any]]) -> tuple[tuple[str, str, str, str], ...]:
    return tuple((d["code"], d["sensor"], d["severity"], d["since"]) for d in diags)


def suppress(diags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """한 원인이 여러 증상을 만들면 원인 하나만 보여 준다 (DX-06)."""
    codes = {d["code"] for d in diags}
    keys = {(d["code"], d["sensor"]) for d in diags}
    if "NODE_OFFLINE" in codes:
        return [d for d in diags if d["code"] == "NODE_OFFLINE"]

    def hidden(d: dict[str, Any]) -> bool:
        c, s = d["code"], d["sensor"]
        reason = (d.get("values") or {}).get("reason")
        if "V12_MISSING" in codes and (c == "WATER_NOT_ARRIVED" or (c == "PUMP_REFUSED" and reason == "no_12v")):
            return True
        if "LEAK" in codes and c == "PUMP_REFUSED" and reason == "leak":
            return True
        if c in ("SHT_RANGE", "SHT_STUCK") and ("SHT_NO_RESP", s) in keys:
            return True
        if c == "SHT_AB_DIFF" and ({("SHT_NO_RESP", "sht_a"), ("SHT_NO_RESP", "sht_b")} & keys):
            return True
        if c in ("SOIL_NO_RISE", "SOIL_STUCK") and ("SOIL_WIRE", s) in keys:
            return True
        if c == "SOIL_AB_DIFF" and ({"SOIL_WIRE", "SOIL_UNCAL"} & codes):
            return True
        return "LC_NO_RESP" in codes and ((c.startswith("LC_") and c != "LC_NO_RESP") or c.startswith("WATER_"))

    return [d for d in diags if not hidden(d)]


def sort_diags(diags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(diags, key=lambda d: (-SEVERITY_ORDER.get(d["severity"], 0), d["since"] or "", d["code"]))


class DiagnosticEngine:
    def __init__(self, path: Path, time_scale: float = 1.0) -> None:
        self.path = path
        self.time_scale = time_scale if time_scale > 0 else 1.0
        self.rules: list[Rule] = []
        self.water_params = WaterParams()
        self.tracks: dict[str, dict[tuple[str, str], _Track]] = {}
        self._visible: dict[str, list[dict[str, Any]]] = {}
        self.load()

    # ------------------------------------------------------------ 설정

    def load(self) -> int:
        """diagnostics.yaml을 읽어 규칙을 만든다. 잘못되면 ValueError (기존 규칙은 그대로)."""
        try:
            with self.path.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError) as e:
            raise ValueError(f"diagnostics.yaml을 읽지 못했어요: {e}") from e
        if not isinstance(raw, dict):
            raise ValueError("diagnostics.yaml 형식이 잘못됐어요 (최상위가 사전이어야 함)")  # noqa: TRY004
        rules_cfg = raw.get("rules") or {}
        known = {cls.code for cls in RULE_CLASSES}
        unknown = set(rules_cfg) - known
        if unknown:
            raise ValueError(f"모르는 규칙 코드: {', '.join(sorted(unknown))}")
        min_clear = float((raw.get("defaults") or {}).get("min_clear_s", 10))
        rules: list[Rule] = []
        try:
            for cls in RULE_CLASSES:
                params = dict(rules_cfg.get(cls.code) or {})
                rules.extend(cls(sensor, params, self.time_scale, min_clear) for sensor in cls.sensors)
            water = WaterParams.from_dict(raw.get("water"))
        except (TypeError, ValueError) as e:
            raise ValueError(f"diagnostics.yaml 값이 잘못됐어요: {e}") from e
        self.rules, self.water_params = rules, water
        log.info("진단 규칙 %d개 (코드 %d종) 읽음: %s", len(rules), len(RULE_CLASSES), self.path.name)
        return len(rules)

    def reload(self) -> int:
        """다시 읽는다. 진행 중인 상태(pending/active)는 같은 규칙이면 이어 간다."""
        return self.load()

    # ------------------------------------------------------------ 평가

    def evaluate(self, ctx: RuleContext) -> EvalOutcome:
        now = ctx.now
        tracks = self.tracks.setdefault(ctx.node_id, {})
        out = EvalOutcome()
        for rule in self.rules:
            tr = tracks.setdefault(rule.key, _Track())
            if rule.eval_every_s and now - tr.last_eval < rule.eval_every_s / self.time_scale:
                res = tr.last_res
            else:
                try:
                    res = rule.evaluate(ctx)
                except Exception:
                    log.exception("규칙 오류 %s/%s", rule.code, rule.sensor)
                    res = None
                tr.last_eval, tr.last_res = now, res
            cond = bool(res is not None and res.active)
            if cond:
                tr.result = res
            if tr.state == "inactive" and cond:
                tr.state, tr.cond_since = "pending", now
            if tr.state == "pending":
                if not cond:
                    tr.state, tr.cond_since = "inactive", None
                elif now - (tr.cond_since or now) >= rule.hold_s:
                    tr.state, tr.since = "active", now
                    out.turned_on.append(self._diag(rule, ctx.node_id, tr, now))
            elif tr.state == "active" and not cond:
                tr.state, tr.clear_since = "clearing", now
            if tr.state == "clearing":
                if cond:
                    tr.state, tr.clear_since = "active", None
                elif now - (tr.clear_since or now) >= rule.clear_s:
                    out.turned_off.append(self._diag(rule, ctx.node_id, tr, now))
                    tracks[rule.key] = _Track(last_eval=tr.last_eval, last_res=tr.last_res)

        raw = [self._diag(r, ctx.node_id, tracks[r.key], now) for r in self.rules
               if tracks[r.key].state in ("active", "clearing")]
        visible = sort_diags(suppress(raw))
        prev = self._visible.get(ctx.node_id, [])
        out.visible = visible
        out.visible_changed = _sig(prev) != _sig(visible)
        out.detail_changed = not out.visible_changed and [d["detail"] for d in prev] != [d["detail"] for d in visible]
        self._visible[ctx.node_id] = visible
        return out

    def _diag(self, rule: Rule, node: str, tr: _Track, now: float) -> dict[str, Any]:
        res = tr.result or RuleResult(True)
        text = text_for(rule.code, rule.sensor, res.variant)
        start = tr.cond_since or tr.since or now
        detail = res.detail_ko.replace("{elapsed}", f"{fmt_dur(now - start)}째")
        return {
            "code": rule.code,
            "node": node,
            "sensor": rule.sensor,
            "severity": rule.severity,
            "title": text.title,
            "detail": detail,
            "causes": list(text.causes),
            "checks": list(text.checks),
            "since": iso_local(tr.since or now),
            "action": rule.action(node),
            "values": res.values,
        }

    # ------------------------------------------------------------ 조회

    def active_codes(self, node: str) -> set[str]:
        """억제 전, active·clearing인 코드 (안전 검사용)."""
        return {k[0] for k, t in self.tracks.get(node, {}).items() if t.state in ("active", "clearing")}

    def visible(self, node: str) -> list[dict[str, Any]]:
        return list(self._visible.get(node, []))
