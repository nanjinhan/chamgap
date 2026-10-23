from __future__ import annotations

import asyncio
import json

from chamgap.commands import CommandManager, CommandResult


def ack(cmd: str, ok: int = 1, msg: str = "") -> dict[str, object]:
    return {"t": "ack", "node": "Z1", "ms": 1, "cmd": cmd, "ok": ok, "msg": msg}


def run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def test_one_command_at_a_time_per_node() -> None:
    async def main() -> None:
        sent: list[str] = []

        async def send(node: str, text: str) -> bool:
            sent.append(f"{node}:{text}")
            return True

        cm = CommandManager(send)
        t1 = asyncio.create_task(cm.request("Z1", "tare"))
        t2 = asyncio.create_task(cm.request("Z1", "info"))
        t3 = asyncio.create_task(cm.request("Z2", "info"))  # 다른 구역은 따로
        await asyncio.sleep(0.01)
        assert sent == ["Z1:tare", "Z2:info"]
        cm.on_message("Z1", ack("tare"))
        r1 = await t1
        assert r1.ok and r1.ack is not None and r1.ack["cmd"] == "tare"
        await asyncio.sleep(0.01)
        assert sent[-1] == "Z1:info"
        cm.on_message("Z1", {"t": "info", "node": "Z1", "ms": 1, "fw": "x"})  # info는 info 메시지로도 완료
        assert (await t2).ok
        cm.on_message("Z2", ack("info"))
        assert (await t3).ok
        await cm.close()

    run(main())


def test_ack_for_other_command_does_not_complete() -> None:
    async def main() -> CommandResult:
        async def send(node: str, text: str) -> bool:
            return True

        cm = CommandManager(send)
        task = asyncio.create_task(cm.request("Z1", "cal 500", timeout=0.2))
        await asyncio.sleep(0.01)
        cm.on_message("Z1", ack("tare"))
        res = await task
        await cm.close()
        return res

    res = run(main())
    assert not res.ok and res.error == "timeout" and "응답이 없어요" in res.message_ko


def test_nack_gives_korean_reason() -> None:
    async def main() -> CommandResult:
        async def send(node: str, text: str) -> bool:
            return True

        cm = CommandManager(send)
        task = asyncio.create_task(cm.request("Z1", "water 10"))
        await asyncio.sleep(0.01)
        cm.on_message("Z1", ack("water", ok=0, msg="cooldown"))
        res = await task
        await cm.close()
        return res

    res = run(main())
    assert not res.ok and res.error == "refused" and "3초" in res.message_ko


def test_send_failure() -> None:
    async def main() -> CommandResult:
        async def send(node: str, text: str) -> bool:
            return False

        cm = CommandManager(send)
        res = await cm.request("Z1", "info")
        await cm.close()
        return res

    res = run(main())
    assert res.error == "send_failed"


def test_stop_skips_queue_and_cancels_pending_water() -> None:
    async def main() -> None:
        sent: list[str] = []

        async def send(node: str, text: str) -> bool:
            sent.append(text)
            return True

        cm = CommandManager(send)
        busy = asyncio.create_task(cm.request("Z1", "tare"))
        water = asyncio.create_task(cm.request("Z1", "water 10"))
        await asyncio.sleep(0.01)
        assert sent == ["tare"]  # water는 대기 중
        stop = asyncio.create_task(cm.request_now("Z1", "stop"))
        await asyncio.sleep(0.01)
        assert sent == ["tare", "stop"]  # tare ack를 기다리지 않고 바로
        w = await water
        assert not w.ok and w.error == "cancelled"
        cm.on_message("Z1", ack("stop"))
        assert (await stop).ok
        cm.on_message("Z1", ack("tare"))
        assert (await busy).ok
        await asyncio.sleep(0.01)
        assert "water 10" not in sent
        await cm.close()

    run(main())


def test_result_to_dict() -> None:
    assert CommandResult(True, ack("info")).to_dict()["ok"] is True
    d = CommandResult(False, None, "timeout", "응답 없음").to_dict()
    assert d == {"ok": False, "error": "timeout", "message": "응답 없음", "ack": None}
    json.dumps(d)
