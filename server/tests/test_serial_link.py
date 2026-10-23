"""pyserial의 loop:// (보낸 것이 그대로 돌아오는 가상 포트)로 시리얼 링크를 시험한다."""

from __future__ import annotations

import asyncio
import threading
import time

from chamgap.links.serial_link import SerialLink, _hint_for


def test_loopback_lines_arrive_split_by_newline() -> None:
    got: list[tuple[str, str]] = []
    events: list[dict[str, object]] = []
    arrived = threading.Event()

    def on_line(src: str, line: str) -> None:
        got.append((src, line))
        if len(got) >= 2:
            arrived.set()

    async def run() -> None:
        link = SerialLink(["loop://"])
        await link.start(on_line, events.append)
        for _ in range(50):
            if link.status()["ports"][0]["connected"]:
                break
            await asyncio.sleep(0.05)
        assert await link.send("Z1", "loop://", '{"t":"data","node":"Z1","ms":1}')
        assert await link.send("Z1", "loop://", "# 메모")
        await asyncio.to_thread(arrived.wait, 3)
        st = link.status()
        await link.stop()
        assert st["ports"][0]["connected"] is True

    asyncio.run(run())
    assert got == [("loop://", '{"t":"data","node":"Z1","ms":1}'), ("loop://", "# 메모")]
    assert any(e["event"] == "port_connected" for e in events)


def test_send_to_unknown_port_fails() -> None:
    async def run() -> bool:
        link = SerialLink(["loop://"])
        await link.start(lambda s, line: None)
        ok = await link.send(None, "COM99", "stop")
        await link.stop()
        return ok

    assert asyncio.run(run()) is False


def test_missing_port_retries_and_reports_error() -> None:
    events: list[dict[str, object]] = []

    async def run() -> dict[str, object]:
        link = SerialLink(["COM250"])
        await link.start(lambda s, line: None, events.append)
        t0 = time.time()
        while not events and time.time() - t0 < 3:
            await asyncio.sleep(0.05)
        st = link.status()
        await link.stop()
        return st

    st = asyncio.run(run())
    port = st["ports"][0]  # type: ignore[index]
    assert port["connected"] is False and port["error"]
    assert events and events[0]["event"] == "port_error"


def test_access_denied_hint() -> None:
    hint = _hint_for("could not open port 'COM5': PermissionError(13, '액세스가 거부되었습니다.', None, 5)")
    assert hint is not None and "시리얼 모니터" in hint
