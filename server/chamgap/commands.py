"""구역별 명령 대기열 (COM-10, COM-11).

- 구역마다 한 번에 하나만 보내고, 같은 cmd 이름의 ack가 오면 완료한다.
- 시간 제한: 기본 3초, tare·cal은 5초. 넘으면 timeout.
- stop은 대기열을 건너뛰고 즉시 보내며, 같은 구역의 대기 중인 water/pump를 취소한다.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from .protocol import command_name

log = logging.getLogger("chamgap.commands")

DEFAULT_TIMEOUT_S = 3.0
TIMEOUTS_S: dict[str, float] = {"tare": 5.0, "cal": 5.0}

# TODO(확인 필요): 지시서 4.3절은 status→data, info→info 로 응답한다고 하고,
# 4.2절은 "명령마다 ack를 정확히 1개" 보낸다고 한다. 둘 다 받아들인다.
ALT_REPLY: dict[str, str] = {"status": "data", "info": "info"}

# 펌웨어 거부 이유 (지시서 4.2 reason) → 한국어
REASON_KO: dict[str, str] = {
    "done": "정해진 시간이 끝났어요",
    "stop": "정지 명령으로 멈췄어요",
    "no_12v": "12V가 없어요 (비상정지·퓨즈·선 확인)",
    "leak": "누수가 감지됐어요",
    "reboot": "재시작으로 멈췄어요",
    "already_on": "이미 급수 중이에요",
    "bad_ms": "펌프 시간은 50~15000ms만 돼요",
    "cooldown": "펌프가 꺼진 지 3초가 안 됐어요. 잠시 뒤 다시 하세요",
    "flow_uncal": "유량 보정이 먼저 필요해요",
}

SendFn = Callable[[str, str], Awaitable[bool]]


@dataclass
class CommandResult:
    ok: bool
    ack: dict[str, Any] | None = None
    error: str | None = None
    message_ko: str = ""

    def to_dict(self) -> dict[str, Any]:
        if self.ok:
            return {"ok": True, "ack": self.ack}
        return {"ok": False, "error": self.error, "message": self.message_ko, "ack": self.ack}


@dataclass
class _Job:
    node: str
    text: str
    name: str
    timeout: float
    future: asyncio.Future[CommandResult] = field(repr=False)
    cancelled: bool = False


class CommandManager:
    def __init__(self, send: SendFn) -> None:
        self._send = send
        self._queues: dict[str, asyncio.Queue[_Job]] = {}
        self._jobs: dict[str, list[_Job]] = {}  # 대기 중 (취소용)
        self._workers: dict[str, asyncio.Task[None]] = {}
        self._waiters: dict[str, list[tuple[str, asyncio.Future[dict[str, Any]]]]] = {}

    # ------------------------------------------------------------ 요청

    async def request(self, node: str, text: str, timeout: float | None = None) -> CommandResult:
        """대기열에 넣고 결과를 기다린다."""
        name = command_name(text)
        loop = asyncio.get_running_loop()
        job = _Job(node, text, name, timeout or TIMEOUTS_S.get(name, DEFAULT_TIMEOUT_S), loop.create_future())
        self._queue(node).put_nowait(job)
        self._jobs.setdefault(node, []).append(job)
        return await job.future

    async def request_now(self, node: str, text: str, timeout: float | None = None) -> CommandResult:
        """대기열을 건너뛰고 즉시 보낸다 (stop)."""
        name = command_name(text)
        if name == "stop":
            for job in self._jobs.get(node, []):
                if job.name in ("water", "pump") and not job.cancelled and not job.future.done():
                    job.cancelled = True
                    job.future.set_result(CommandResult(False, None, "cancelled", "정지 명령으로 취소됐어요"))
        return await self._execute(node, text, name, timeout or TIMEOUTS_S.get(name, DEFAULT_TIMEOUT_S))

    def pending(self, node: str) -> int:
        return sum(1 for j in self._jobs.get(node, []) if not j.cancelled and not j.future.done())

    # ------------------------------------------------------------ 응답 받기 (hub가 부름)

    def on_message(self, node: str, data: dict[str, Any]) -> None:
        t = data.get("t")
        waiters = self._waiters.get(node)
        if not waiters:
            return
        for i, (name, fut) in enumerate(waiters):
            if fut.done():
                continue
            is_ack = t == "ack" and str(data.get("cmd", "")).lower() == name
            is_alt = t != "ack" and ALT_REPLY.get(name) == t
            if not (is_ack or is_alt):
                continue
            fut.set_result(data)
            del waiters[i]
            return

    # ------------------------------------------------------------ 내부

    def _queue(self, node: str) -> asyncio.Queue[_Job]:
        q = self._queues.get(node)
        if q is None:
            q = self._queues[node] = asyncio.Queue()
            self._workers[node] = asyncio.create_task(self._worker(node, q), name=f"cmd-{node}")
        return q

    async def _worker(self, node: str, q: asyncio.Queue[_Job]) -> None:
        while True:
            job = await q.get()
            try:
                if job.cancelled or job.future.done():
                    continue
                result = await self._execute(node, job.text, job.name, job.timeout)
                if not job.future.done():
                    job.future.set_result(result)
            except Exception as e:  # 워커는 죽으면 안 된다
                log.exception("명령 실행 오류 %s %s", node, job.text)
                if not job.future.done():
                    job.future.set_result(CommandResult(False, None, "internal", f"서버 오류: {e}"))
            finally:
                jobs = self._jobs.get(node, [])
                if job in jobs:
                    jobs.remove(job)

    async def _execute(self, node: str, text: str, name: str, timeout: float) -> CommandResult:
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        entry = (name, fut)
        self._waiters.setdefault(node, []).append(entry)  # 보내기 전에 등록 (ack가 먼저 올 수 있음)
        try:
            sent = await self._send(node, text)
            if not sent:
                return CommandResult(False, None, "send_failed", f"{node}로 명령을 보내지 못했어요 (연결 확인)")
            try:
                reply = await asyncio.wait_for(fut, timeout)
            except TimeoutError:
                return CommandResult(False, None, "timeout", f"{node} 응답이 없어요 ({timeout:.0f}초)")
        finally:
            waiters = self._waiters.get(node, [])
            if entry in waiters:
                waiters.remove(entry)
        if reply.get("t") != "ack":
            return CommandResult(True, reply)
        if reply.get("ok") in (1, True):
            return CommandResult(True, reply)
        msg = str(reply.get("msg") or "")
        return CommandResult(False, reply, "refused", REASON_KO.get(msg, f"{node}이 거부했어요: {msg or name}"))

    async def close(self) -> None:
        for t in self._workers.values():
            t.cancel()
        for t in self._workers.values():
            with contextlib.suppress(asyncio.CancelledError):
                await t
        self._workers.clear()
        self._queues.clear()
