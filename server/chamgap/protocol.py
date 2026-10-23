"""통신 규약 (지시서 4장): 줄 해석, 메시지 모델, 명령 문자열 만들기.

규약은 바꾸지 않는다. 키 이름·명령 문법·줄 끝(\\n)은 ESP32 펌웨어와 같다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from .clock import iso_local

# node 없이 오는 시험 스케치(00~05) 메시지의 t 값 (지시서 4.2)
TEST_TYPES = frozenset({"i2c", "sht", "soil", "soilcal", "lc", "lccal", "pwr", "pump", "pumpcal", "evt"})

# 웹에서 /api/nodes/{node}/command 로 보낼 수 있는 명령 (pump·water·stop은 전용 API로만)
WEB_ALLOWED = frozenset({"help", "status", "info", "tare", "cal", "soilcal", "flow", "interval", "id", "reboot"})

PUMP_MS_MIN = 50
PUMP_MS_MAX = 15000
INTERVAL_MIN = 500
INTERVAL_MAX = 600000


class _Envelope(BaseModel):
    """모든 JSON 메시지의 공통 키 (COM-05). 모르는 키는 그대로 둔다 (COM-09)."""

    model_config = ConfigDict(extra="allow")

    t: str
    node: str | None = None
    ms: int | float | None = None


@dataclass(frozen=True)
class ParsedMessage:
    src: str
    raw: str
    ts: float
    data: dict[str, Any]  # 원본 + pc_time + src

    @property
    def t(self) -> str:
        return str(self.data["t"])

    @property
    def node(self) -> str | None:
        n = self.data.get("node")
        return n if isinstance(n, str) and n else None

    @property
    def is_test(self) -> bool:
        """node가 없는 JSON = 시험 스케치 메시지."""
        return self.node is None


@dataclass(frozen=True)
class LogLine:
    """JSON이 아닌 줄: '#' 메모, 부팅 로그, 깨진 JSON."""

    src: str
    text: str
    ts: float
    pc_time: str
    note: bool  # '#'로 시작 (COM-02)
    bad_json: bool  # '{'로 시작했지만 해석 실패

    def to_dict(self) -> dict[str, Any]:
        return {
            "src": self.src,
            "text": self.text,
            "pc_time": self.pc_time,
            "note": self.note,
            "bad_json": self.bad_json,
            "dir": "rx",
        }


def normalize_node(node: Any) -> str | None:
    if node is None:
        return None
    s = str(node).strip()
    return s.upper() if s else None


def parse_line(src: str, line: str, ts: float) -> ParsedMessage | LogLine | None:
    """ESP32에서 온 한 줄을 해석한다. 빈 줄이면 None."""
    text = line.strip("\r\n").strip()
    if not text:
        return None
    pc_time = iso_local(ts)
    if not text.startswith("{"):
        return LogLine(src, text, ts, pc_time, note=text.startswith("#"), bad_json=False)
    try:
        obj = json.loads(text)
        env = _Envelope.model_validate(obj) if isinstance(obj, dict) else None
    except (ValueError, ValidationError):
        env = None
    if env is None or not isinstance(obj, dict):
        return LogLine(src, text, ts, pc_time, note=False, bad_json=True)
    data: dict[str, Any] = dict(obj)
    data["t"] = env.t
    node = normalize_node(obj.get("node"))
    if node is not None:
        data["node"] = node
    elif "node" in data:
        del data["node"]
    data["pc_time"] = pc_time
    data["src"] = src
    return ParsedMessage(src=src, raw=text, ts=ts, data=data)


# ---------------------------------------------------------------- 명령 만들기 (4.3)


def _num(x: float) -> str:
    """10.0 → '10', 23.50 → '23.5'"""
    if float(x).is_integer():
        return str(int(x))
    return f"{float(x):.3f}".rstrip("0").rstrip(".")


def cmd_water(ml: float) -> str:
    return f"water {_num(ml)}"


def cmd_pump(ms: int) -> str:
    return f"pump {int(ms)}"


def cmd_stop() -> str:
    return "stop"


def cmd_tare() -> str:
    return "tare"


def cmd_cal(g: float) -> str:
    return f"cal {_num(g)}"


def cmd_soilcal(ch: str, kind: str) -> str:
    return f"soilcal {ch} {kind}"


def cmd_flow(ms: int, g: float) -> str:
    return f"flow {int(ms)} {_num(g)}"


def cmd_interval(ms: int) -> str:
    return f"interval {int(ms)}"


def cmd_info() -> str:
    return "info"


def cmd_status() -> str:
    return "status"


def command_name(text: str) -> str:
    """명령 문자열의 첫 낱말 (소문자). ack의 cmd와 비교할 때 쓴다."""
    parts = text.strip().split()
    return parts[0].lower() if parts else ""


class CommandError(ValueError):
    def __init__(self, code: str, message_ko: str) -> None:
        super().__init__(message_ko)
        self.code = code
        self.message_ko = message_ko


_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")


def _float_arg(s: str, name: str) -> float:
    try:
        return float(s)
    except ValueError:
        raise CommandError("bad_arg", f"{name} 값이 숫자가 아니에요: {s}") from None


def _int_arg(s: str, name: str) -> int:
    try:
        return int(float(s))
    except ValueError:
        raise CommandError("bad_arg", f"{name} 값이 숫자가 아니에요: {s}") from None


def parse_web_command(text: str) -> str:
    """웹에서 온 임의 명령을 허용 목록으로 검사하고 정리된 명령 문자열을 돌려준다."""
    parts = text.strip().split()
    if not parts:
        raise CommandError("empty", "명령이 비어 있어요")
    name, args = parts[0].lower(), parts[1:]
    if name in ("pump", "water", "stop"):
        raise CommandError("not_allowed", f"'{name}'은 급수·정지 전용 버튼으로만 보낼 수 있어요")
    if name not in WEB_ALLOWED:
        raise CommandError("not_allowed", f"허용되지 않은 명령이에요: {name}")

    if name in ("help", "status", "info", "tare", "reboot"):
        if args:
            raise CommandError("bad_arg", f"'{name}'에는 값을 붙이지 않아요")
        return name
    if name == "cal":
        if len(args) != 1:
            raise CommandError("bad_arg", "형식: cal <g>  예: cal 500")
        g = _float_arg(args[0], "무게")
        if not 0 < g <= 10000:
            raise CommandError("bad_arg", "보정 무게는 0~10000g 사이여야 해요")
        return cmd_cal(g)
    if name == "soilcal":
        if len(args) != 2 or args[0].lower() not in ("a", "b") or args[1].lower() not in ("air", "wet"):
            raise CommandError("bad_arg", "형식: soilcal <a|b> <air|wet>  예: soilcal a air")
        return cmd_soilcal(args[0].lower(), args[1].lower())
    if name == "flow":
        if len(args) != 2:
            raise CommandError("bad_arg", "형식: flow <ms> <g>  예: flow 10000 23.5")
        ms = _int_arg(args[0], "시간")
        g = _float_arg(args[1], "무게")
        if not PUMP_MS_MIN <= ms <= PUMP_MS_MAX:
            raise CommandError("bad_arg", f"시간은 {PUMP_MS_MIN}~{PUMP_MS_MAX}ms 사이여야 해요")
        if g <= 0:
            raise CommandError("bad_arg", "받은 물 무게는 0보다 커야 해요")
        return cmd_flow(ms, g)
    if name == "interval":
        if len(args) != 1:
            raise CommandError("bad_arg", "형식: interval <ms>  예: interval 2000")
        ms = _int_arg(args[0], "주기")
        if not INTERVAL_MIN <= ms <= INTERVAL_MAX:
            raise CommandError("bad_arg", f"주기는 {INTERVAL_MIN}~{INTERVAL_MAX}ms 사이여야 해요")
        return cmd_interval(ms)
    # id
    if len(args) != 1 or not _ID_RE.match(args[0]):
        raise CommandError("bad_arg", "형식: id <이름>  예: id z2 (영문·숫자 16자 이내)")
    return f"id {args[0].lower()}"
