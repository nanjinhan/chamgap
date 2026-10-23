"""구역 상태 (지시서 5.3절 /api/state 형식을 그대로 만든다)."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .clock import iso_local

SEVERITY_ORDER: dict[str, int] = {"ok": 0, "info": 1, "warn": 2, "fault": 3, "offline": 4}
SENSOR_KEYS = ("sht_a", "sht_b", "soil_a", "soil_b", "scale", "pump", "power")
DEFAULT_SAMPLE_MS = 5000


def worst(levels: Iterable[str], default: str = "ok") -> str:
    best = default
    for lv in levels:
        if SEVERITY_ORDER.get(lv, 0) > SEVERITY_ORDER.get(best, 0):
            best = lv
    return best


def effective_ml(ml: float | None, dur: float | None, ran: float | None) -> float:
    """pump_off의 ml(예상량)을 실제 켜진 시간 비율로 줄인다.

    TODO(확인 필요): 펌웨어 pump_off의 ml이 '예상 mL'인지 '실제 켜진 시간 기준 mL'인지.
    지금은 예상 mL로 보고 ran/dur 비율을 곱한다.
    """
    if ml is None:
        return 0.0
    if dur and ran is not None and 0 <= ran < dur:
        return float(ml) * float(ran) / float(dur)
    return float(ml)


@dataclass
class PumpState:
    on: bool = False
    started_ts: float | None = None
    dur_ms: int | None = None
    ml: float | None = None
    last_ml: float | None = None
    last_ts: float | None = None
    today_ml: float = 0.0
    today_date: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "on": self.on,
            "started_at": iso_local(self.started_ts) if self.on and self.started_ts else None,
            "dur": self.dur_ms if self.on else None,
            "ml": self.ml if self.on else None,
            "last_ml": None if self.last_ml is None else round(self.last_ml, 1),
            "last_at": iso_local(self.last_ts) if self.last_ts else None,
            "today_ml": round(self.today_ml, 1),
        }


@dataclass
class NodeState:
    node: str
    src: str | None = None
    first_seen_ts: float | None = None
    last_seen_ts: float | None = None
    last_data_ts: float | None = None
    latest: dict[str, Any] | None = None
    info: dict[str, Any] | None = None
    pump: PumpState = field(default_factory=PumpState)
    online: bool = False
    mqtt_online: bool | None = None
    diagnostics: list[dict[str, Any]] = field(default_factory=list)  # 보이는 진단 (억제 뒤)
    recent: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=50))
    info_requested: bool = False
    last_seq: int | None = None

    @property
    def sample_ms(self) -> int:
        v = (self.info or {}).get("sample_ms")
        try:
            return int(v) if v else DEFAULT_SAMPLE_MS
        except (TypeError, ValueError):
            return DEFAULT_SAMPLE_MS

    def _val(self, key: str) -> Any:
        return (self.latest or {}).get(key)

    def sensor_values(self) -> dict[str, Any]:
        return {
            "sht_a": {"temp": self._val("temp_a"), "rh": self._val("rh_a")},
            "sht_b": {"temp": self._val("temp_b"), "rh": self._val("rh_b")},
            "soil_a": self._val("soil_a"),
            "soil_b": self._val("soil_b"),
            "scale": self._val("weight_g"),
            "pump": self._val("pump"),
            "power": self._val("v12"),
        }

    def sensors(self) -> dict[str, dict[str, Any]]:
        values = self.sensor_values()
        out: dict[str, dict[str, Any]] = {}
        for key in SENSOR_KEYS:
            if not self.online:
                status = "offline"
            else:
                status = worst(d["severity"] for d in self.diagnostics if d.get("sensor") == key)
            out[key] = {"status": status, "value": values[key]}
        return out

    def status(self) -> str:
        if not self.online:
            return "offline"
        return worst(d["severity"] for d in self.diagnostics)

    def to_dict(self) -> dict[str, Any]:
        return {
            "node": self.node,
            "src": self.src,
            "online": self.online,
            "last_seen": iso_local(self.last_seen_ts) if self.last_seen_ts else None,
            "status": self.status(),
            "latest": self.latest,
            "info": self.info,
            "pump": self.pump.to_dict(),
            "sensors": self.sensors(),
            "diagnostics": list(self.diagnostics),
        }
