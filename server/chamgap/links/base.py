"""Link 추상 클래스: ESP32와 주고받는 경로 (serial / mqtt / mock)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any, Literal

LinkMode = Literal["serial", "mqtt", "mock"]

# (src, line). 링크는 어느 스레드에서든 부를 수 있고, 받는 쪽(hub)이 이벤트 루프로 넘긴다.
LineCallback = Callable[[str, str], None]
# 연결 상태가 바뀌었을 때 (예: {"event": "port_connected", "port": "COM5"})
StatusCallback = Callable[[dict[str, Any]], None]


class Link(ABC):
    mode: LinkMode

    @abstractmethod
    async def start(self, on_line: LineCallback, on_status: StatusCallback | None = None) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        """명령 한 줄을 보낸다. node 또는 src(포트 이름)로 대상을 정한다. 보냈으면 True."""
        ...

    @abstractmethod
    def status(self) -> dict[str, Any]:
        """/api/link 에 그대로 나가는 상태."""
        ...

    def sources(self) -> list[str]:
        """지금 연결된 경로 이름들 (모두 정지 때 node를 모르는 포트에도 보내기 위해)."""
        return []
