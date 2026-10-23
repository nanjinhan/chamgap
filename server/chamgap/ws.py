"""WebSocket 관리 (지시서 5.2): 접속자 목록과 방송.

- 접속하면 snapshot을 1번, 이후 변화가 있을 때마다 보낸다.
- 느린 접속자 때문에 서버가 막히지 않게 접속자마다 보내기 큐를 두고, 500개가 넘게 쌓이면 끊는다.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger("chamgap.ws")

MAX_QUEUE = 500
PING_EVERY_S = 15.0


class _Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=MAX_QUEUE)
        self.dropped = False
        self.peer = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"


class WsManager:
    def __init__(self) -> None:
        self.clients: set[_Client] = set()

    def __len__(self) -> int:
        return len(self.clients)

    def broadcast(self, msg: dict[str, Any]) -> None:
        """어디서든 막히지 않고 부를 수 있다 (루프 안)."""
        if not self.clients:
            return
        text = json.dumps(msg, ensure_ascii=False, default=str)
        for c in list(self.clients):
            if c.dropped:
                continue
            try:
                c.queue.put_nowait(text)
            except asyncio.QueueFull:
                log.warning("WebSocket %s: 보내기 대기 %d개 초과 → 연결을 끊어요", c.peer, MAX_QUEUE)
                c.dropped = True
                self.clients.discard(c)
                with contextlib.suppress(asyncio.QueueFull):
                    c.queue.put_nowait("")  # 보내기 작업을 깨워 끝낸다

    async def serve(self, ws: WebSocket, snapshot: Callable[[], dict[str, Any]]) -> None:
        await ws.accept()
        client = _Client(ws)
        self.clients.add(client)
        log.info("WebSocket 접속 %s (지금 %d명)", client.peer, len(self.clients))
        sender = asyncio.create_task(self._send_loop(client))
        try:
            await ws.send_text(json.dumps(snapshot(), ensure_ascii=False, default=str))
            while True:  # 웹앱은 보내는 것이 없지만, 끊김을 알아채려고 읽는다
                await ws.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            self.clients.discard(client)
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await sender
            log.info("WebSocket 끊김 %s (지금 %d명)", client.peer, len(self.clients))

    async def _send_loop(self, c: _Client) -> None:
        try:
            while True:
                text = await c.queue.get()
                if c.dropped or not text:
                    break
                await c.ws.send_text(text)
        except (WebSocketDisconnect, RuntimeError, OSError) as e:  # 보내다 끊기면 끝낸다
            log.debug("WebSocket %s 보내기 끝: %s", c.peer, e)
        finally:
            if c.dropped:
                with contextlib.suppress(Exception):
                    await c.ws.close(code=1013, reason="too slow")
