"""급수 전 검사 (지시서 SAFE-03, SAFE-04).

ESP32로 보내기 전에 순서대로 검사하고, 실패하면 보내지 않고 이유를 돌려준다.
최종 판단은 ESP32가 한다 (SYS-02). 이 검사는 그 앞의 한 겹 더.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .config import SafetyCfg
from .protocol import PUMP_MS_MAX, PUMP_MS_MIN
from .state import NodeState


@dataclass
class Check:
    key: str  # 실패 코드
    ok: bool
    label_ko: str
    detail_ko: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "ok": self.ok, "label_ko": self.label_ko, "detail_ko": self.detail_ko}


@dataclass
class Preflight:
    checks: list[Check]

    @property
    def ok(self) -> bool:
        return all(c.ok for c in self.checks)

    @property
    def first_fail(self) -> Check | None:
        return next((c for c in self.checks if not c.ok), None)

    def to_dict(self) -> dict[str, Any]:
        f = self.first_fail
        return {
            "ok": self.ok,
            "error": f.key if f else None,
            "message": f.detail_ko if f else None,
            "checks": [c.to_dict() for c in self.checks],
        }


def _num(x: float) -> str:
    return f"{x:.0f}" if float(x).is_integer() else f"{x:.1f}"


def _common(node_id: str, node: NodeState | None, codes: set[str]) -> dict[str, Check]:
    online = node is not None and node.online
    pump_on = node is not None and node.pump.on
    return {
        "offline": Check("offline", online, "구역 연결됨",
                         "연결됨" if online else f"{node_id}이 연결되어 있지 않아요"),
        "pump_on": Check("pump_on", not pump_on, "펌프 꺼져 있음",
                         "꺼져 있음" if not pump_on else "이미 급수 중이에요"),
        "leak": Check("leak", "LEAK" not in codes, "누수 없음",
                      "누수 감지 없음" if "LEAK" not in codes else "누수가 감지되어 급수를 막았어요"),
        "no_12v": Check("no_12v", "V12_MISSING" not in codes, "12V 전원 있음",
                        "12V 정상" if "V12_MISSING" not in codes else "12V가 없어요 (비상정지·퓨즈 확인)"),
    }


def water_preflight(
    node_id: str, node: NodeState | None, ml: float, active_codes: Iterable[str], cfg: SafetyCfg
) -> Preflight:
    codes = set(active_codes)
    c = _common(node_id, node, codes)
    max_shot, max_day = cfg.max_ml_per_shot, cfg.max_ml_per_day
    today = node.pump.today_ml if node else 0.0
    ml_ok = 0 < ml <= max_shot
    day_ok = today + ml <= max_day
    mlps = float((node.info or {}).get("pump_mlps") or 0) if node else 0.0
    flow_ok = mlps > 0
    scale_ok = "LC_NO_RESP" not in codes
    checks = [
        c["offline"],
        c["pump_on"],
        Check("bad_ml", ml_ok, f"급수량 1~{_num(max_shot)}mL",
              f"{_num(ml)}mL" if ml_ok else f"한 번에 1~{_num(max_shot)}mL만 줄 수 있어요"),
        Check("daily_limit", day_ok, f"오늘 한도 {_num(max_day)}mL",
              f"오늘 {_num(today)}mL + {_num(ml)}mL" if day_ok
              else f"오늘 급수 한도({_num(max_day)}mL)를 넘어요 (지금 {_num(today)}mL)"),
        Check("flow_uncal", flow_ok, "유량 보정됨",
              f"{mlps:.2f} mL/s" if flow_ok else "유량 보정이 먼저 필요해요"),
        c["leak"],
        c["no_12v"],
        Check("scale_dead", scale_ok, "무게 센서 응답",
              "응답함" if scale_ok else "무게 센서가 응답하지 않아 급수 결과를 확인할 수 없어요"),
    ]
    return Preflight(checks)


def flow_cal_preflight(node_id: str, node: NodeState | None, ms: int, active_codes: Iterable[str]) -> Preflight:
    """유량 보정용 펌프 실행: 1·2·6·7번 검사 + 시간 범위 (유량 보정 전이어도 된다)."""
    codes = set(active_codes)
    c = _common(node_id, node, codes)
    ms_ok = PUMP_MS_MIN <= ms <= PUMP_MS_MAX
    return Preflight([
        c["offline"],
        c["pump_on"],
        Check("bad_ms", ms_ok, f"시간 {PUMP_MS_MIN}~{PUMP_MS_MAX}ms",
              f"{ms}ms" if ms_ok else f"펌프 시간은 {PUMP_MS_MIN}~{PUMP_MS_MAX}ms만 돼요"),
        c["leak"],
        c["no_12v"],
    ])
