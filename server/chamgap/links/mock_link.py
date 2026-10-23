"""가짜 ESP32 3대 (SYS-04, SRV-05): 물리 흉내 + 펌웨어와 같은 명령 응답 + 고장 시나리오.

MockNode는 시간을 인자로 받는 순수 로직이라 테스트에서 시간을 건너뛸 수 있다.
MockLink는 그것을 이벤트 루프에서 0.1초마다 돌리는 껍데기다.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..clock import Clock
from ..protocol import INTERVAL_MAX, INTERVAL_MIN, PUMP_MS_MAX, PUMP_MS_MIN, command_name
from .base import LineCallback, Link, StatusCallback

NODES = ("Z1", "Z2", "Z3")
FW = "mock-0.1"

# 지시서 6.4절
SCENARIOS = (
    "normal", "offline", "sht_b_dead", "sht_b_hot", "soil_a_unplugged", "soil_ab_diff",
    "lc_dead", "lc_noisy", "estop_pressed", "water_clog", "leak",
)

# 시나리오 → 떠야 하는 진단 (README 표, 검수 기준)
SCENARIO_EXPECTS: dict[str, list[str]] = {
    "normal": [],
    "offline": ["NODE_OFFLINE"],
    "sht_b_dead": ["SHT_NO_RESP"],
    "sht_b_hot": ["SHT_AB_DIFF"],
    "soil_a_unplugged": ["SOIL_WIRE"],
    "soil_ab_diff": ["SOIL_AB_DIFF"],
    "lc_dead": ["LC_NO_RESP"],
    "lc_noisy": ["LC_NOISY"],
    "estop_pressed": ["V12_MISSING"],
    "water_clog": ["WATER_NOT_ARRIVED"],
    "leak": ["LEAK"],
}


@dataclass
class ZonePreset:
    base_weight: float
    true_mlps: float  # 실제 펌프 유량 (mock 물리)
    pump_mlps: float  # 저장된 유량 보정값 (0이면 보정 전)
    temp_off: float
    soil0: float


PRESETS: dict[str, ZonePreset] = {
    "Z1": ZonePreset(1200.0, 2.35, 2.35, 0.0, 0.55),
    "Z2": ZonePreset(1285.0, 2.10, 2.10, 0.3, 0.58),
    "Z3": ZonePreset(1140.0, 2.20, 0.0, -0.2, 0.52),  # 유량 보정 전 → FLOW_UNCAL
}

# 토양 센서의 '실제' 특성 (mV): 공기 / 물
SOIL_TRUE = {"a": (2480, 1150), "b": (2510, 1170)}


@dataclass
class _Water:
    """급수 한 번: 무게는 펌프가 도는 동안 흐르고 몇 초 늦게 판에 닿는다. 토양은 30~90초에 걸쳐 오른다."""

    start: float
    rate_gps: float
    end: float | None = None
    soil_ramp_s: float = 60.0
    lag_s: float = 4.0

    def arrived_g(self, now: float) -> float:
        end = self.end if self.end is not None else now
        flowing = max(0.0, min(now - self.lag_s, end) - self.start)
        return self.rate_gps * flowing

    def soil_rise(self, now: float) -> float:
        if self.end is None:
            total = self.rate_gps * max(0.0, now - self.start)
        else:
            total = self.rate_gps * (self.end - self.start)
        frac = min(1.0, max(0.0, (now - self.start - 5.0) / self.soil_ramp_s))
        return total * 0.004 * frac


@dataclass
class MockNode:
    key: str
    speed: float
    t0: float
    rng: random.Random = field(default_factory=random.Random)

    def __post_init__(self) -> None:
        p = PRESETS.get(self.key, PRESETS["Z1"])
        self.preset = p
        self.node = self.key
        self.pending_id: str | None = None
        self.sample_ms = max(INTERVAL_MIN, int(5000 / max(self.speed, 0.01)))
        self.scenario = "normal"
        # NVS 보정값
        self.soil_cal = {"a": (2480, 1150), "b": (2510, 1170)}
        self.soil_cal_flag = 1
        self.lc_cal = 1
        self.lc_offset = 81234 + int(self.rng.random() * 500)
        self.lc_scale = 412.5
        self.pump_mlps = p.pump_mlps
        self.leak_sensor = 0
        # 실행 상태
        self.boot_ts = self.t0
        self.seq = 0
        self.next_data = self.t0 + 0.3 + self.rng.random() * 0.5
        self.pump_on_ts: float | None = None
        self.pump_dur_ms = 0
        self.pump_ml: float | None = None
        self.pump_off_ts: float | None = None
        self.waters: list[_Water] = []
        self.cal_phase: str | None = None  # 'empty' (tare 뒤 빈 판) | 'known' (cal 무게 올림)
        self.cal_until = 0.0
        self.known_g = 0.0
        self.tare_done = False
        self.pending: list[tuple[float, str]] = []  # (보낼 시각, 줄)
        self.rebooting_until: float | None = None

    # ------------------------------------------------------------ 메시지 만들기

    def _ms(self, now: float) -> int:
        return int((now - self.boot_ts) * 1000)

    def _msg(self, now: float, t: str, **kw: Any) -> str:
        return json.dumps({"t": t, "node": self.node, "ms": self._ms(now), **kw}, ensure_ascii=False)

    def _ack(self, now: float, cmd: str, ok: bool = True, msg: str = "") -> str:
        return self._msg(now, "ack", cmd=cmd, ok=1 if ok else 0, msg=msg)

    def boot_lines(self, now: float) -> list[str]:
        return [
            f"# {self.node} mock 노드 시작 ({FW})",
            self._msg(now, "evt", ev="boot", fw=FW, reset=1, sht_a=1, sht_b=1),
            self.info_line(now),
        ]

    def info_line(self, now: float) -> str:
        (a_air, a_wet), (b_air, b_wet) = self.soil_cal["a"], self.soil_cal["b"]
        return self._msg(
            now, "info", fw=FW, sample_ms=self.sample_ms, soil_cal=self.soil_cal_flag,
            soil_a_air=a_air, soil_a_wet=a_wet, soil_b_air=b_air, soil_b_wet=b_wet,
            lc_cal=self.lc_cal, lc_offset=self.lc_offset, lc_scale=round(self.lc_scale, 4),
            pump_mlps=round(self.pump_mlps, 3), v12_sense=1, leak_sensor=self.leak_sensor, mqtt=0,
        )

    # ------------------------------------------------------------ 물리 흉내

    def _sim_hours(self, now: float) -> float:
        return (now - self.t0) * self.speed / 3600.0

    def _air(self, now: float) -> tuple[float, float]:
        local = datetime.fromtimestamp(now)
        sec = local.hour * 3600 + local.minute * 60 + local.second + (now - self.t0) * (self.speed - 1)
        s = math.sin(2 * math.pi * (sec / 86400.0 - 0.375))  # 15시에 가장 따뜻
        temp = 23.0 + self.preset.temp_off + 1.5 * s + self.rng.gauss(0, 0.05)
        rh = 45.0 - 5.0 * s + self.rng.gauss(0, 0.2)
        return temp, rh

    def _soil_true(self, now: float) -> float:
        v = self.preset.soil0 - 0.004 * self._sim_hours(now)
        v += sum(w.soil_rise(now) for w in self.waters)
        return min(1.0, max(0.0, v))

    def _load_g(self, now: float) -> float:
        if self.cal_phase and now < self.cal_until:
            return 0.0 if self.cal_phase == "empty" else self.known_g
        self.cal_phase = None
        w = self.preset.base_weight - 3.0 * self._sim_hours(now)
        return w + sum(x.arrived_g(now) for x in self.waters)

    def _soil_reading(self, ch: str, true_v: float) -> tuple[int, float | None]:
        t_air, t_wet = SOIL_TRUE[ch]
        mv = round(t_air - true_v * (t_air - t_wet) + self.rng.gauss(0, 3))
        air, wet = self.soil_cal[ch]
        if mv < 150 or mv > 3050 or air - wet < 100:
            return mv, None
        return mv, round(min(1.2, max(-0.2, (air - mv) / (air - wet))), 3)

    def make_data(self, now: float) -> str:
        self.seq += 1
        sc = self.scenario
        temp_a, rh_a = self._air(now)
        temp_b = temp_a + 0.2 + self.rng.gauss(0, 0.05) + (3.0 if sc == "sht_b_hot" else 0.0)
        rh_b = rh_a - 0.5 + self.rng.gauss(0, 0.2)
        sht_b_ok = sc != "sht_b_dead"

        soil_a_true = self._soil_true(now)
        soil_b_true = soil_a_true - (0.35 if sc == "soil_ab_diff" else 0.02) + self.rng.gauss(0, 0.003)
        soil_a_mv, soil_a = self._soil_reading("a", soil_a_true + self.rng.gauss(0, 0.002))
        soil_b_mv, soil_b = self._soil_reading("b", max(0.0, soil_b_true))
        if sc == "soil_a_unplugged":
            soil_a_mv, soil_a = self.rng.randint(5, 20), None

        hx_ok = sc != "lc_dead"
        sd = self.rng.uniform(8, 12) if sc == "lc_noisy" else self.rng.uniform(0.3, 0.8)
        weight: float | None = self._load_g(now) + self.rng.gauss(0, sd * 0.5)
        if not hx_ok or not self.lc_cal:
            weight = None
        v12 = 0.0 if sc == "estop_pressed" else 12.0 + self.rng.gauss(0, 0.05)
        leak = (1 if sc == "leak" else 0) if self.leak_sensor else None

        return self._msg(
            now, "data", seq=self.seq,
            sht_a_ok=1, temp_a=round(temp_a, 2), rh_a=round(rh_a, 2),
            sht_b_ok=1 if sht_b_ok else 0,
            temp_b=round(temp_b, 2) if sht_b_ok else None, rh_b=round(rh_b, 2) if sht_b_ok else None,
            soil_a_mv=soil_a_mv, soil_a=soil_a, soil_b_mv=soil_b_mv, soil_b=soil_b,
            hx_ok=1 if hx_ok else 0,
            weight_g=None if weight is None else round(weight, 1),
            weight_sd=None if weight is None else round(sd, 2),
            v12=round(v12, 2), leak=leak, pump=1 if self.pump_on_ts is not None else 0, rssi=None,
        )

    # ------------------------------------------------------------ 시간 진행

    def poll(self, now: float) -> list[str]:
        """지금까지 일어날 일을 줄로 돌려준다 (예약된 응답, 펌프 자동 꺼짐, 주기 data)."""
        out: list[str] = []
        if self.rebooting_until is not None:
            if now < self.rebooting_until:
                return out
            self._finish_reboot(now)
            out += self.boot_lines(now)
        due = [x for x in self.pending if x[0] <= now]
        self.pending = [x for x in self.pending if x[0] > now]
        out += [line for _, line in sorted(due)]
        # 펌웨어 안전: 12V 없음·누수면 즉시 끔, 정해진 시간이 지나면 스스로 끔
        if self.pump_on_ts is not None:
            if self.scenario == "estop_pressed":
                out.append(self._pump_off(now, "no_12v"))
            elif self.scenario == "leak":
                out.append(self._pump_off(now, "leak"))
            elif now >= self.pump_on_ts + self.pump_dur_ms / 1000.0:
                out.append(self._pump_off(self.pump_on_ts + self.pump_dur_ms / 1000.0, "done", now))
        if now >= self.next_data:
            data = self.make_data(now)
            self.next_data = max(self.next_data + self.sample_ms / 1000.0, now + 0.05)
            if self.scenario != "offline":
                out.append(data)
        self.waters = [w for w in self.waters if w.end is None or now - w.end < 7200]
        if self.scenario == "offline":
            return [x for x in out if x.startswith("#")]
        return out

    # ------------------------------------------------------------ 펌프

    def _refuse(self, now: float, cmd: str, reason: str, ms: int, ml: float | None) -> list[str]:
        return [self._msg(now, "evt", ev="refused", reason=reason, dur=ms, ml=ml), self._ack(now, cmd, False, reason)]

    def _pump_request(self, now: float, cmd: str, ms: int, ml: float | None) -> list[str]:
        if not PUMP_MS_MIN <= ms <= PUMP_MS_MAX:
            return self._refuse(now, cmd, "bad_ms", ms, ml)
        if self.pump_on_ts is not None:
            return self._refuse(now, cmd, "already_on", ms, ml)
        if self.pump_off_ts is not None and now - self.pump_off_ts < 3.0:
            return self._refuse(now, cmd, "cooldown", ms, ml)
        if self.scenario == "estop_pressed":
            return self._refuse(now, cmd, "no_12v", ms, ml)
        if self.scenario == "leak":
            return self._refuse(now, cmd, "leak", ms, ml)
        self.pump_on_ts, self.pump_dur_ms, self.pump_ml = now, ms, ml
        eff = self.rng.uniform(0.95, 1.0)
        rate = 0.0 if self.scenario == "water_clog" else self.preset.true_mlps * eff
        self.waters.append(_Water(start=now, rate_gps=rate, soil_ramp_s=self.rng.uniform(30, 90)))
        return [self._msg(now, "evt", ev="pump_on", dur=ms, ml=ml), self._ack(now, cmd)]

    def _pump_off(self, at: float, reason: str, now: float | None = None) -> str:
        assert self.pump_on_ts is not None
        ran = round((at - self.pump_on_ts) * 1000)
        if self.waters and self.waters[-1].end is None:
            self.waters[-1].end = at
        line = self._msg(now or at, "evt", ev="pump_off", reason=reason, dur=self.pump_dur_ms, ran=ran, ml=self.pump_ml)
        self.pump_on_ts, self.pump_off_ts, self.pump_ml = None, at, None
        return line

    # ------------------------------------------------------------ 명령 (지시서 4.3)

    def handle(self, text: str, now: float) -> list[str]:
        if self.scenario == "offline" or self.rebooting_until is not None:
            return []
        parts = text.strip().split()
        if not parts:
            return []
        cmd, args = command_name(text), parts[1:]
        try:
            return self._handle(cmd, args, now)
        except (ValueError, IndexError):
            return [self._ack(now, cmd, False, "bad args")]

    def _handle(self, cmd: str, args: list[str], now: float) -> list[str]:
        if cmd == "help":
            return [self._ack(now, cmd, True, "help status info pump water stop tare cal soilcal flow interval id reboot")]
        if cmd == "status":
            return [self.make_data(now), self._ack(now, cmd)]
        if cmd == "info":
            return [self.info_line(now), self._ack(now, cmd)]
        if cmd == "pump":
            return self._pump_request(now, cmd, int(float(args[0])), None)
        if cmd == "water":
            ml = float(args[0])
            if self.pump_mlps <= 0:
                return [self._ack(now, cmd, False, "flow_uncal")]
            return self._pump_request(now, cmd, round(ml / self.pump_mlps * 1000), ml)
        if cmd == "stop":
            out = [self._pump_off(now, "stop")] if self.pump_on_ts is not None else []
            return [*out, self._ack(now, cmd, True, "" if out else "not running")]
        if cmd == "tare":
            if self.scenario == "lc_dead":
                self.pending.append((now + 2.0, self._ack(now + 2.0, cmd, False, "hx711 no response")))
                return []
            self.cal_phase, self.cal_until, self.tare_done = "empty", now + 90.0, True
            self.lc_offset = 81234 + self.rng.randint(-300, 300)
            self.pending.append((now + 2.0, self._ack(now + 2.0, cmd, True, f"offset={self.lc_offset}")))
            return []
        if cmd == "cal":
            g = float(args[0])
            if not self.tare_done:
                return [self._ack(now, cmd, False, "tare first")]
            if self.scenario == "lc_dead":
                return [self._ack(now, cmd, False, "hx711 no response")]
            self.cal_phase, self.cal_until, self.known_g = "known", now + 60.0, g
            self.lc_scale, self.lc_cal = 412.5 + self.rng.uniform(-3, 3), 1
            self.pending.append((now + 1.5, self._ack(now + 1.5, cmd, True, f"scale={self.lc_scale:.4f}")))
            return []
        if cmd == "soilcal":
            ch, kind = args[0].lower(), args[1].lower()
            if ch not in ("a", "b") or kind not in ("air", "wet"):
                return [self._ack(now, cmd, False, "usage: soilcal a|b air|wet")]
            # mock: 사람이 시킨 대로 공기/물에 두었다고 보고 '실제' 값을 저장한다
            air, wet = self.soil_cal[ch]
            t_air, t_wet = SOIL_TRUE[ch]
            mv = (t_air if kind == "air" else t_wet) + self.rng.randint(-8, 8)
            self.soil_cal[ch] = (mv, wet) if kind == "air" else (air, mv)
            self.soil_cal_flag = 1
            return [self._ack(now, cmd, True, f"{ch}_{kind}={mv}")]
        if cmd == "flow":
            ms, g = int(float(args[0])), float(args[1])
            if ms <= 0 or g <= 0:
                return [self._ack(now, cmd, False, "bad args")]
            self.pump_mlps = g / (ms / 1000.0)
            return [self._ack(now, cmd, True, f"mlps={self.pump_mlps:.3f}")]
        if cmd == "interval":
            ms = int(float(args[0]))
            if not INTERVAL_MIN <= ms <= INTERVAL_MAX:
                return [self._ack(now, cmd, False, "range 500-600000")]
            self.sample_ms = ms
            self.next_data = now + ms / 1000.0
            return [self._ack(now, cmd)]
        if cmd == "id":
            self.pending_id = args[0].upper()
            return [self._ack(now, cmd, True, "reboot to apply")]
        if cmd == "reboot":
            out = [self._pump_off(now, "reboot")] if self.pump_on_ts is not None else []
            self.rebooting_until = now + 1.0
            return [*out, self._ack(now, cmd)]
        return [self._ack(now, cmd, False, "unknown command")]

    def _finish_reboot(self, now: float) -> None:
        self.rebooting_until = None
        if self.pending_id:
            self.node, self.pending_id = self.pending_id, None
        self.boot_ts, self.seq = now, 0
        self.next_data = now + 0.5
        self.cal_phase = None

    # ------------------------------------------------------------ 시나리오

    def set_scenario(self, name: str, now: float) -> list[str]:
        if name not in SCENARIOS:
            raise ValueError(name)
        prev, self.scenario = self.scenario, name
        out = [f"# {self.node} 시나리오: {prev} → {name}"]
        leak_sensor = 1 if name == "leak" else 0
        if leak_sensor != self.leak_sensor:
            self.leak_sensor = leak_sensor
            out.append(self.info_line(now))
        if prev == "offline" and name != "offline":
            self.next_data = now + 0.2
        return out


class MockLink(Link):
    mode = "mock"

    def __init__(self, speed: float, scenarios: dict[str, str], clock: Clock, seed: int | None = None) -> None:
        self.speed = speed if speed > 0 else 1.0
        self.clock = clock
        self.initial = {k.upper(): v for k, v in scenarios.items()}
        for name in self.initial.values():
            if name not in SCENARIOS:
                raise ValueError(f"모르는 mock 시나리오: {name} (가능: {', '.join(SCENARIOS)})")
        base = random.Random(seed)
        now = clock.now()
        self.nodes: dict[str, MockNode] = {
            k: MockNode(k, self.speed, now, random.Random(base.random())) for k in NODES
        }
        self._on_line: LineCallback | None = None
        self._task: asyncio.Task[None] | None = None

    def _src(self, mn: MockNode) -> str:
        return f"mock:{mn.key}"

    def _emit(self, mn: MockNode, lines: list[str]) -> None:
        if self._on_line is None:
            return
        for line in lines:
            self._on_line(self._src(mn), line)

    async def start(self, on_line: LineCallback, on_status: StatusCallback | None = None) -> None:
        self._on_line = on_line
        now = self.clock.now()
        for key, mn in self.nodes.items():
            mn.t0 = mn.boot_ts = now
            self._emit(mn, mn.boot_lines(now))
            if key in self.initial:
                self._emit(mn, mn.set_scenario(self.initial[key], now))
        self._task = asyncio.create_task(self._run(), name="mock-link")

    async def _run(self) -> None:
        while True:
            now = self.clock.now()
            for mn in self.nodes.values():
                self._emit(mn, mn.poll(now))
            await asyncio.sleep(0.1)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def _find(self, node: str | None, src: str | None) -> MockNode | None:
        for mn in self.nodes.values():
            if (src and self._src(mn) == src) or (node and mn.node == node.upper()):
                return mn
        return None

    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        mn = self._find(node, src)
        if mn is None:
            return False
        self._emit(mn, mn.handle(text, self.clock.now()))
        return True

    def set_scenario(self, node: str, scenario: str) -> None:
        mn = self._find(node, None)
        if mn is None:
            raise KeyError(node)
        self._emit(mn, mn.set_scenario(scenario, self.clock.now()))

    def status(self) -> dict[str, Any]:
        return {
            "mode": "mock",
            "speed": self.speed,
            "ports": [
                {"port": self._src(mn), "connected": mn.scenario != "offline", "node": mn.node,
                 "scenario": mn.scenario}
                for mn in self.nodes.values()
            ],
            "scenarios": list(SCENARIOS),
        }

    def sources(self) -> list[str]:
        return [self._src(mn) for mn in self.nodes.values()]
