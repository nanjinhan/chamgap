"""중심: 메시지 받기 → 상태 갱신 → 진단 → 저장 → 방송.

모든 상태 변경은 asyncio 이벤트 루프 한 곳에서만 일어난다.
링크(스레드)는 _on_line_threadsafe 로 줄을 넘기고, 루프의 _consume 이 하나씩 처리한다.

메시지 처리 순서 (프롬프트 ① 3장):
 1. 해석 → JSONL에 원본 기록
 2. node가 있으면 그 구역 상태 갱신 (latest, info, last_seen, pump)
 3. evt면 펌프 상태·오늘 급수량 갱신, pump_off(done)이면 급수 추적 시작
 4. 급수 추적: 급수 전후 안정 무게 비교 → water_result
 5. 진단 엔진 실행 → 바뀌면 diag 방송 + events 기록
 6. data는 SQLite에 저장
 7. WebSocket으로 data / evt / ack / log 방송
 + 1초 타이머: NODE_OFFLINE과 시간 기반 규칙 (메시지가 안 와도 진단이 뜬다)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import statistics
from collections.abc import Callable
from typing import Any, cast

from .clock import Clock, iso_local, local_date
from .commands import CommandManager, CommandResult
from .config import Config
from .diagnostics.engine import DiagnosticEngine, sort_diags
from .diagnostics.rules import RuleContext
from .links.base import Link
from .protocol import (
    LogLine,
    ParsedMessage,
    cmd_info,
    cmd_pump,
    cmd_stop,
    cmd_water,
    command_name,
    parse_line,
)
from .safety import Preflight, flow_cal_preflight, water_preflight
from .state import NodeState, effective_ml
from .storage import Storage
from .tracking import KEEP_S, History, WaterRun, WaterTracker
from .ws import PING_EVERY_S, WsManager

log = logging.getLogger("chamgap.hub")
rx_log = logging.getLogger("chamgap.rx")

STABLE_SD_G = 3.0  # 무게 흔들림이 이 이하면 '안정' (지시서 6.3 WATER_*)
REFRESH_INFO_AFTER = frozenset({"tare", "cal", "soilcal", "flow", "interval"})
DETAIL_PUSH_S = 15.0  # 숫자만 바뀐 진단은 이 간격으로만 다시 방송

MsgPred = Callable[[dict[str, Any]], bool]
EmitHook = Callable[[dict[str, Any]], None]


def _fmt(v: Any, spec: str, unit: str = "") -> str:
    if v is None:
        return "--"
    try:
        return f"{float(v):{spec}}{unit}"
    except (TypeError, ValueError):
        return "--"


def summarize_data(d: dict[str, Any]) -> str:
    """콘솔 한 줄 요약: Z1 #42 23.4°C 45% 흙 0.53 1234g"""
    return (
        f"{d.get('node')} #{d.get('seq', '?')} {_fmt(d.get('temp_a'), '.1f', '°C')} "
        f"{_fmt(d.get('rh_a'), '.0f', '%')} 흙 {_fmt(d.get('soil_a'), '.2f')} "
        f"{_fmt(d.get('weight_g'), '.0f', 'g')}" + (" 펌프ON" if d.get("pump") == 1 else "")
    )


class Hub:
    def __init__(self, cfg: Config, link: Link, clock: Clock, storage: Storage | None = None) -> None:
        self.cfg = cfg
        self.link = link
        self.clock = clock
        self.storage = storage or Storage(cfg.log_dir, cfg.data_dir, cfg.storage.keep_days)
        self.time_scale = cfg.mock.speed if cfg.mode == "mock" else 1.0
        self.engine = DiagnosticEngine(cfg.diagnostics_path, self.time_scale)
        self.nodes: dict[str, NodeState] = {}
        self.routes: dict[str, str] = {}  # 구역 → 경로(src) (SRV-06)
        self.histories: dict[str, History] = {}
        self.waters: dict[str, WaterTracker] = {}
        self.port_opened: dict[str, float] = {}  # 경로 → 연결된 시각 (그 직후의 boot는 정상)
        self.commands = CommandManager(self._send_to_node)
        self.ws = WsManager()
        self.emit_hooks: list[EmitHook] = [self.ws.broadcast]
        self._last_ping = 0.0
        self._last_diag_push: dict[str, float] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[tuple[str, str, Any]] = asyncio.Queue()
        self._tasks: list[asyncio.Task[None]] = []
        self._msg_waiters: list[tuple[str, MsgPred, asyncio.Future[dict[str, Any]]]] = []

    # ------------------------------------------------------------ 시작·끝

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.storage.start()
        try:
            samples, events = await asyncio.to_thread(self._load_recent)
            self.restore(samples, events)
        except Exception:
            log.exception("지난 기록을 다시 읽지 못했어요 (계속 진행)")
        self._tasks.append(asyncio.create_task(self._consume(), name="hub-consume"))
        self._tasks.append(asyncio.create_task(self._ticker(), name="hub-tick"))
        now = self.clock.now()
        for src in self.link.sources():
            self.port_opened[src] = now
        await self.link.start(self._on_line_threadsafe, self._on_status_threadsafe)
        if self.cfg.mode == "mock":
            for src in self.link.sources():
                self.port_opened[src] = now

    async def stop(self) -> None:
        await self.link.stop()
        await self.commands.close()
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        self._tasks.clear()
        self.storage.stop()

    # ------------------------------------------------------------ 재시작 때 기록 다시 읽기

    def _load_recent(self) -> tuple[list[tuple[str, float, dict[str, Any]]], list[dict[str, Any]]]:
        since = self.clock.now() - KEEP_S
        samples = self.storage.recent_samples(since)
        events = self.storage.events(kinds=["evt", "info", "mark", "water_result"], since=since, limit=5000)
        return samples, list(reversed(events))

    def restore(self, samples: list[tuple[str, float, dict[str, Any]]], events: list[dict[str, Any]]) -> None:
        """SQLite의 최근 6시간으로 이력 링버퍼·마지막 값·오늘 급수량을 다시 채운다."""
        for node_id, ts, raw in samples:
            node = self._node(node_id, ts)
            self.histories[node_id].add(ts, raw)
            node.latest, node.last_data_ts, node.last_seen_ts = raw, ts, ts
            seq = raw.get("seq")
            node.last_seq = seq if isinstance(seq, int) else None
        today = local_date(self.clock.now())
        for e in events:
            node_id, ts, kind, p = e["node"], e["ts"], e["kind"], e["payload"]
            if not node_id or node_id not in self.nodes:
                continue
            node, hist = self.nodes[node_id], self.histories[node_id]
            node.pump.today_date = today
            is_today = local_date(ts) == today
            if kind == "info":
                node.info = p
            elif kind == "mark":
                hist.add_event(ts, "mark", note=p.get("note"))
            elif kind == "water_result" and p.get("kind") == "flow_cal" and is_today:
                node.pump.today_ml += max(0.0, float(p.get("delta_g") or 0))
            elif kind == "evt":
                ev = p.get("ev")
                if ev in ("boot", "pump_on", "pump_off", "refused"):
                    hist.add_event(ts, str(ev), reason=p.get("reason"), reset=p.get("reset"), expected=True)
                if ev == "pump_off" and is_today and p.get("ml") is not None:
                    node.pump.today_ml += effective_ml(p.get("ml"), p.get("dur"), p.get("ran"))
                    node.pump.last_ml, node.pump.last_ts = effective_ml(p.get("ml"), p.get("dur"), p.get("ran")), ts
        if samples:
            log.info("지난 기록 복원: 구역 %s, 측정값 %d개, 사건 %d개", ", ".join(sorted(self.nodes)), len(samples),
                     len(events))

    # ------------------------------------------------------------ 링크 → 루프

    def _on_line_threadsafe(self, src: str, line: str) -> None:
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, ("line", src, line))

    def _on_status_threadsafe(self, event: dict[str, Any]) -> None:
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, ("status", "", event))

    async def _consume(self) -> None:
        while True:
            kind, src, payload = await self._queue.get()
            try:
                if kind == "line":
                    self.process_line(src, payload)
                else:
                    self.process_link_event(payload)
            except Exception:
                log.exception("메시지 처리 실패: %s %r", src, payload)

    async def _ticker(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            try:
                self.tick()
            except Exception:
                log.exception("타이머 처리 실패")

    # ------------------------------------------------------------ 방송

    def emit(self, type_: str, node: str | None, payload: dict[str, Any], **extra: Any) -> None:
        msg = {"type": type_, "node": node, "payload": payload, "server_time": iso_local(self.clock.now()), **extra}
        for hook in self.emit_hooks:
            try:
                hook(msg)
            except Exception:
                log.exception("방송 실패")

    # ------------------------------------------------------------ 처리

    def process_line(self, src: str, line: str) -> None:
        now = self.clock.now()
        msg = parse_line(src, line, now)
        if msg is None:
            return
        if isinstance(msg, LogLine):
            self._handle_log(msg)
            return
        self.storage.write_jsonl(now, msg.data)  # 1. 원본 기록
        if msg.is_test:
            self._handle_test(msg)
            return
        self._handle_node_message(msg)

    def _handle_log(self, msg: LogLine) -> None:
        self.storage.write_jsonl(msg.ts, {"t": "_log", **msg.to_dict()})
        rx_log.info("%s %s %s", msg.src, "#" if msg.note else "·", msg.text.lstrip("# "))
        self.emit("log", self._node_of(msg.src), msg.to_dict())

    def _handle_test(self, msg: ParsedMessage) -> None:
        rx_log.info("%s 시험 %s", msg.src, msg.raw)
        self.emit("test", None, msg.data)

    def _node_of(self, src: str) -> str | None:
        for n, s in self.routes.items():
            if s == src:
                return n
        return None

    def _node(self, node_id: str, ts: float) -> NodeState:
        node = self.nodes.get(node_id)
        if node is None:
            node = self.nodes[node_id] = NodeState(node=node_id, first_seen_ts=ts)
            self.histories[node_id] = History()
            self.waters[node_id] = WaterTracker(self.engine.water_params)
            log.info("새 구역 %s", node_id)
        return node

    def _handle_node_message(self, msg: ParsedMessage) -> None:
        node_id = msg.node
        assert node_id is not None
        ts = msg.ts
        node = self._node(node_id, ts)
        hist = self.histories[node_id]
        # 2. 구역 상태 갱신 + 경로 기억
        if self.routes.get(node_id) != msg.src:
            self.routes[node_id] = msg.src
            node.src = msg.src
        node.last_seen_ts = ts
        node.recent.append({**msg.data, "_ts": ts})
        t = msg.t
        d = msg.data
        if t == "data":
            self._track_seq(node, hist, d, ts)
            node.latest = d
            node.last_data_ts = ts
            hist.add(ts, d)
            for run in self.waters[node_id].on_data(ts, d):
                self._water_result(node_id, run)
            self.storage.write_sample(node_id, ts, d)  # 6. SQLite
            rx_log.info(summarize_data(d))
        elif t == "info":
            node.info = d
            self.storage.write_event(node_id, ts, "info", d)
            rx_log.info("%s info fw=%s sample_ms=%s", node_id, d.get("fw"), d.get("sample_ms"))
        elif t == "evt":
            self._handle_evt(node, hist, msg)
        elif t == "ack":
            rx_log.info("%s ack %s ok=%s %s", node_id, d.get("cmd"), d.get("ok"), d.get("msg") or "")
            if d.get("ok") in (1, True) and str(d.get("cmd", "")).lower() in ("tare", "cal"):
                hist.add_event(ts, "cal", cmd=d.get("cmd"))
            self.storage.write_event(node_id, ts, "ack", d)
        elif t == "online":
            node.mqtt_online = bool(d.get("online"))
            rx_log.info("%s MQTT %s", node_id, "접속" if node.mqtt_online else "끊김 (유언 메시지)")
        if t in ("ack", "data", "info"):
            self.commands.on_message(node_id, d)
        self._resolve_waiters(node_id, d)
        self._run_diag(node_id)  # 5. 진단
        # 7. 방송
        if t == "data":
            self.emit("data", node_id, d, online=node.online, last_seen=iso_local(ts))
        elif t == "evt":
            self.emit("evt", node_id, d, pump=node.pump.to_dict())
        elif t == "ack":
            self.emit("ack", node_id, d)
        elif t == "info":
            self.emit("evt", node_id, {**d, "t": "info"}, info=d)
        # 서버가 나중에 켜져 info를 못 받은 구역은 한 번 물어본다
        if t == "data" and node.info is None and not node.info_requested and self._loop is not None:
            node.info_requested = True
            self._loop.create_task(self.commands.request(node_id, cmd_info()))

    def _track_seq(self, node: NodeState, hist: History, d: dict[str, Any], ts: float) -> None:
        seq = d.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool):
            return
        last = node.last_seq
        if last is not None:
            if seq < last:
                boot = hist.last_event(("boot",))
                hist.add_event(ts, "seq_reset", expected=bool(boot and ts - boot.ts < 60), seq=seq, last=last)
            elif seq > last + 1:
                hist.add_event(ts, "seq_gap", missed=seq - last - 1)
        node.last_seq = seq

    def _handle_evt(self, node: NodeState, hist: History, msg: ParsedMessage) -> None:
        d = msg.data
        ev = d.get("ev")
        ts = msg.ts
        p = node.pump
        water = self.waters[node.node]
        self._roll_day(node, ts)
        if ev == "pump_on":
            p.on, p.started_ts = True, ts
            p.dur_ms = d.get("dur")
            p.ml = d.get("ml")
            p.today_ml += float(p.ml or 0)  # 안전 쪽으로: 켜질 때 예상량 전부를 더한다
            latest = node.latest or {}
            water.on_pump_on(ts, p.ml, self.stable_weight(node.node),
                             {"a": latest.get("soil_a"), "b": latest.get("soil_b")})
            hist.add_event(ts, "pump_on", ml=p.ml, dur=p.dur_ms)
        elif ev == "pump_off":
            given = effective_ml(d.get("ml"), d.get("dur"), d.get("ran"))
            if d.get("ml") is not None:
                p.today_ml -= float(d["ml"]) - given  # 일찍 꺼진 만큼 되돌린다
                p.last_ml = given
            p.last_ts = ts
            p.on, p.started_ts, p.dur_ms, p.ml = False, None, None, None
            water.on_pump_off(ts, d.get("reason"))
            hist.add_event(ts, "pump_off", reason=d.get("reason"))
        elif ev == "boot":
            p.on = False
            node.last_seq = None
            hist.add_event(ts, "boot", reset=d.get("reset"), fw=d.get("fw"))
        elif ev == "refused":
            hist.add_event(ts, "refused", reason=d.get("reason"))
        self.storage.write_event(node.node, ts, "evt", d)
        extra = {k: v for k, v in d.items() if k not in ("t", "node", "ms", "ev", "pc_time", "src")}
        rx_log.info("%s evt %s %s", node.node, ev, extra)

    def _roll_day(self, node: NodeState, ts: float) -> None:
        today = local_date(ts)
        if node.pump.today_date != today:
            node.pump.today_date = today
            node.pump.today_ml = 0.0

    def _water_result(self, node_id: str, run: WaterRun) -> None:
        res = run.to_result()
        log.info("%s 급수 결과: 예상 %smL → %sg (%s)", node_id, res["expected_ml"], res["delta_g"], res["verdict"])
        self.record_event(node_id, "water_result", {"kind": "water", **res})
        self.emit("evt", node_id, {"t": "water_result", "node": node_id, **res})

    # ------------------------------------------------------------ 진단

    def tick(self) -> None:
        """1초마다: 시간 기반 규칙, 급수 추적 마감, 날짜 바뀜, 15초마다 ping."""
        now = self.clock.now()
        if now - self._last_ping >= PING_EVERY_S:
            self._last_ping = now
            self.ws.broadcast({"type": "ping", "server_time": iso_local(now)})
        for node_id, node in self.nodes.items():
            self._roll_day(node, now)
            for run in self.waters[node_id].tick(now):
                self._water_result(node_id, run)
            self._run_diag(node_id)

    def _run_diag(self, node_id: str) -> None:
        node = self.nodes[node_id]
        now = self.clock.now()
        ctx = RuleContext(node_id, now, node, self.histories[node_id], self.waters[node_id],
                          port_opened_ts=self.port_opened.get(node.src or ""))
        out = self.engine.evaluate(ctx)
        for diag in out.turned_on:
            log.warning("진단 켜짐 %s %s/%s: %s · %s", node_id, diag["code"], diag["sensor"], diag["title"],
                        diag["detail"])
            self.record_event(node_id, "diag_on", diag)
        for diag in out.turned_off:
            log.info("진단 꺼짐 %s %s/%s", node_id, diag["code"], diag["sensor"])
            self.record_event(node_id, "diag_off", diag)
        was_online = node.online
        node.online = "NODE_OFFLINE" not in self.engine.active_codes(node_id)
        node.diagnostics = out.visible
        last_push = self._last_diag_push.get(node_id, 0.0)
        if out.visible_changed or (out.detail_changed and now - last_push >= DETAIL_PUSH_S):
            self._last_diag_push[node_id] = now
            self.emit("diag", node_id, {"diagnostics": out.visible, "status": node.status(),
                                        "sensors": node.sensors(), "online": node.online})
        if was_online != node.online:
            ev = {"event": "node_online" if node.online else "node_offline", "node": node_id, "online": node.online}
            log.info("%s %s", node_id, "온라인" if node.online else "오프라인")
            self.record_event(node_id, "link", ev)
            self.emit("link", node_id, {**ev, "link": self.link_status()})

    def all_diagnostics(self) -> list[dict[str, Any]]:
        return sort_diags([d for n in self.nodes.values() for d in n.diagnostics])

    def active_codes(self, node_id: str) -> set[str]:
        """억제 전 활성 진단 코드 (안전 검사용)."""
        return self.engine.active_codes(node_id)

    def reload_diagnostics(self) -> int:
        n = self.engine.reload()
        for w in self.waters.values():
            w.p = self.engine.water_params
        self.record_event(None, "mark", {"note": "진단 기준값 다시 읽음", "auto": True})
        return n

    # ------------------------------------------------------------ 연결 사건·기록

    def process_link_event(self, event: dict[str, Any]) -> None:
        now = self.clock.now()
        if event.get("event") in ("port_connected", "mqtt_connected") and event.get("port"):
            self.port_opened[str(event["port"])] = now
        self.record_event(self._node_of(str(event.get("port", ""))), "link", event)
        self.emit("link", self._node_of(str(event.get("port", ""))), {**event, "link": self.link_status()})

    def record_event(self, node: str | None, kind: str, payload: dict[str, Any]) -> None:
        """서버가 만든 사건 (진단 변화, 명령, 메모, 급수 결과, 연결)."""
        now = self.clock.now()
        self.storage.write_jsonl(
            now, {"t": "_server", "kind": kind, "node": node, "pc_time": iso_local(now), "payload": payload}
        )
        self.storage.write_event(node, now, kind, payload)

    def mark(self, node_id: str | None, note: str) -> dict[str, Any]:
        """메모 (SRV-09). 예: 'Z1 물 20mL 줌'"""
        now = self.clock.now()
        if node_id and node_id in self.histories:
            self.histories[node_id].add_event(now, "mark", note=note)
        payload = {"note": note}
        self.record_event(node_id, "mark", payload)
        item = {"t": "mark", "node": node_id, "note": note, "pc_time": iso_local(now)}
        self.emit("evt", node_id, item)
        return item

    # ------------------------------------------------------------ 메시지 기다리기

    def wait_for(self, node: str, pred: MsgPred) -> asyncio.Future[dict[str, Any]]:
        """조건에 맞는 메시지가 오면 끝나는 Future. 시간 제한은 부르는 쪽에서."""
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        entry = (node, pred, fut)
        self._msg_waiters.append(entry)

        def _cleanup(_: object) -> None:
            if entry in self._msg_waiters:
                self._msg_waiters.remove(entry)

        fut.add_done_callback(_cleanup)
        return fut

    async def wait_msg(self, node: str, pred: MsgPred, timeout: float) -> dict[str, Any] | None:
        try:
            return await asyncio.wait_for(self.wait_for(node, pred), timeout)
        except TimeoutError:
            return None

    def _resolve_waiters(self, node: str, data: dict[str, Any]) -> None:
        for n, pred, fut in list(self._msg_waiters):
            if n != node or fut.done():
                continue
            try:
                hit = pred(data)
            except Exception:
                log.exception("waiter 조건 오류")
                continue
            if hit:
                fut.set_result(data)

    # ------------------------------------------------------------ 명령 보내기

    async def _send_to_node(self, node: str, text: str) -> bool:
        src = self.routes.get(node)
        ok = await self.link.send(node, src, text)
        now = self.clock.now()
        self.storage.write_jsonl(
            now, {"t": "_tx", "node": node, "src": src, "text": text, "sent": ok, "pc_time": iso_local(now)}
        )
        log.info("→ %s %s%s", node, text, "" if ok else " (보내기 실패)")
        self.emit("log", node, {"src": src, "text": text, "pc_time": iso_local(now), "dir": "tx", "sent": ok,
                                "note": False, "bad_json": False})
        return ok

    def preflight(self, node_id: str, ml: float) -> Preflight:
        return water_preflight(node_id, self.nodes.get(node_id), ml, self.active_codes(node_id), self.cfg.safety)

    async def water(self, node_id: str, ml: float) -> tuple[Preflight, CommandResult | None]:
        pf = self.preflight(node_id, ml)
        if not pf.ok:
            return pf, None
        res = await self.commands.request(node_id, cmd_water(ml))
        self.record_event(node_id, "command", {"cmd": cmd_water(ml), **res.to_dict()})
        return pf, res

    async def stop_node(self, node_id: str) -> CommandResult:
        res = await self.commands.request_now(node_id, cmd_stop())
        self.record_event(node_id, "command", {"cmd": "stop", **res.to_dict()})
        return res

    async def stop_all(self) -> dict[str, Any]:
        nodes = list(self.nodes)
        results = await asyncio.gather(*(self.stop_node(n) for n in nodes))
        # 구역 이름을 아직 모르는 포트에도 보낸다
        known = set(self.routes.values())
        extra = [src for src in self.link.sources() if src not in known]
        for src in extra:
            await self.link.send(None, src, cmd_stop())
        out = {n: r.to_dict() for n, r in zip(nodes, results, strict=True)}
        return {"ok": all(r.ok for r in results), "results": out, "unknown_ports": extra}

    async def command(self, node_id: str, text: str) -> CommandResult:
        res = await self.commands.request(node_id, text)
        self.record_event(node_id, "command", {"cmd": text, **res.to_dict()})
        # 보정·설정이 바뀌면 info를 다시 받아 둔다 (안전 검사·진단이 info를 본다)
        if res.ok and command_name(text) in REFRESH_INFO_AFTER:
            await self.commands.request(node_id, cmd_info())
        return res

    def set_mock_scenario(self, node_id: str, scenario: str) -> None:
        from .links.mock_link import MockLink

        if self.cfg.mode != "mock":
            raise RuntimeError("mock 모드가 아니에요")
        cast(MockLink, self.link).set_scenario(node_id, scenario)
        self.record_event(node_id, "mark", {"note": f"mock 시나리오: {scenario}", "auto": True})

    async def raw(self, src: str, text: str) -> bool:
        ok = await self.link.send(None, src, text)
        now = self.clock.now()
        self.storage.write_jsonl(
            now, {"t": "_tx", "node": None, "src": src, "text": text, "sent": ok, "raw": True,
                  "pc_time": iso_local(now)}
        )
        self.emit("log", self._node_of(src), {"src": src, "text": text, "pc_time": iso_local(now), "dir": "tx",
                                              "sent": ok, "note": False, "bad_json": False})
        return ok

    # ------------------------------------------------------------ 무게

    def stable_weights(self, node_id: str, since: float | None = None) -> list[float]:
        """흔들림(sd)이 기준 이하인 무게들 (최근 메시지에서, 오래된 것부터)."""
        node = self.nodes.get(node_id)
        if node is None:
            return []
        out: list[float] = []
        for d in node.recent:
            if d.get("t") != "data" or d.get("weight_g") is None or d.get("weight_sd") is None:
                continue
            if since is not None and float(d.get("_ts", 0)) < since:
                continue
            if float(d["weight_sd"]) <= STABLE_SD_G:
                out.append(float(d["weight_g"]))
        return out

    def stable_weight(self, node_id: str, since: float | None = None, n: int = 3) -> float | None:
        w = self.stable_weights(node_id, since)[-n:]
        return round(statistics.median(w), 1) if len(w) >= n else None

    def scale_calibrated(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if node is None or node.latest is None or node.latest.get("weight_g") is None:
            return False
        return (node.info or {}).get("lc_cal", 1) not in (0, False)

    async def flow_cal_run(self, node_id: str, ms: int) -> tuple[Preflight, dict[str, Any]]:
        """유량 보정용 펌프 실행 + 전후 무게. 웹에서 pump를 보내는 유일한 길."""
        pf = flow_cal_preflight(node_id, self.nodes.get(node_id), ms, self.active_codes(node_id))
        if not pf.ok:
            return pf, {}
        weigh = self.scale_calibrated(node_id)
        before = self.stable_weight(node_id) if weigh else None
        off_wait = self.wait_for(node_id, lambda d: d.get("t") == "evt" and d.get("ev") == "pump_off")
        res = await self.commands.request(node_id, cmd_pump(ms))
        self.record_event(node_id, "command", {"cmd": cmd_pump(ms), "flow_cal": True, **res.to_dict()})
        if not res.ok:
            off_wait.cancel()
            return pf, res.to_dict()
        try:
            off = await asyncio.wait_for(off_wait, ms / 1000 + 8)
        except TimeoutError:
            return pf, {"ok": False, "error": "timeout", "message": "펌프 꺼짐 신호가 오지 않았어요"}
        off_ts = self.clock.now()
        after = await self._wait_stable_after(node_id, off_ts, 60.0) if before is not None else None
        delta = round(after - before, 1) if (after is not None and before is not None) else None
        node = self.nodes[node_id]
        if delta is not None and delta > 0:
            node.pump.today_ml += delta
        result = {"ok": True, "ms": ms, "ran": off.get("ran"), "reason": off.get("reason"),
                  "before_g": before, "after_g": after, "delta_g": delta}
        self.record_event(node_id, "water_result", {"kind": "flow_cal", **result})
        self.emit("evt", node_id, {"t": "water_result", "node": node_id, "kind": "flow_cal", **result})
        return pf, result

    async def _wait_stable_after(self, node_id: str, since: float, timeout: float) -> float | None:
        """since 이후 안정된 무게 3개가 2g 안에 모이면 그 중앙값."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            w = self.stable_weights(node_id, since)[-3:]
            if len(w) == 3 and max(w) - min(w) <= 2.0:
                return round(statistics.median(w), 1)
            remain = deadline - loop.time()
            if remain <= 0:
                return round(statistics.median(w), 1) if w else None
            await self.wait_msg(node_id, lambda d: d.get("t") == "data", remain)

    # ------------------------------------------------------------ 조회

    def link_status(self) -> dict[str, Any]:
        st = self.link.status()
        src_to_node = {src: node for node, src in self.routes.items()}
        for p in st.get("ports", []):
            p["node"] = p.get("node") or src_to_node.get(p.get("port", ""))
        st["server_time"] = iso_local(self.clock.now())
        st["mock"] = self.cfg.mode == "mock"
        st["allow_raw"] = self.cfg.server.allow_raw
        st["pin_required"] = self.cfg.server.pin is not None
        return st

    def snapshot(self) -> dict[str, Any]:
        return {"type": "snapshot", "state": self.state(), "server_time": iso_local(self.clock.now())}

    def node_detail(self, node_id: str) -> dict[str, Any]:
        node = self.nodes[node_id]
        recent = [{k: v for k, v in m.items() if k != "_ts"} for m in node.recent]
        return {**node.to_dict(), "recent": recent[::-1], "route": self.routes.get(node_id),
                "pending_commands": self.commands.pending(node_id)}

    def state(self) -> dict[str, Any]:
        """지시서 5.3절 /api/state."""
        return {
            "server_time": iso_local(self.clock.now()),
            "link": self.link_status(),
            "nodes": {n: s.to_dict() for n, s in sorted(self.nodes.items())},
        }
