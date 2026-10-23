"""진단 시험 도구: 가짜 시간으로 hub에 메시지를 넣고 진단을 본다."""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from chamgap.clock import FakeClock
from chamgap.config import Config
from chamgap.hub import Hub
from chamgap.links.mock_link import MockNode
from chamgap.storage import Storage

from .helpers import FakeLink, data_line, evt_line, info_line


def make_cfg(tmp_path: Path, mode: str = "serial") -> Config:
    cfg = Config()
    cfg.base_dir = tmp_path / "server"
    cfg.mode = mode  # type: ignore[assignment]
    return cfg


class _Base:
    def __init__(self, tmp_path: Path) -> None:
        self.clock = FakeClock()
        self.cfg = make_cfg(tmp_path)
        self.storage = Storage(self.cfg.log_dir, self.cfg.data_dir)
        self.storage.start()
        self.hub = Hub(self.cfg, FakeLink(), self.clock, self.storage)

    def codes(self, node: str = "Z1") -> set[str]:
        n = self.hub.nodes.get(node)
        return {d["code"] for d in n.diagnostics} if n else set()

    def diag_keys(self, node: str = "Z1") -> set[tuple[str, str]]:
        n = self.hub.nodes.get(node)
        return {(d["code"], d["sensor"]) for d in n.diagnostics} if n else set()

    def diag(self, code: str, node: str = "Z1") -> dict[str, Any] | None:
        n = self.hub.nodes.get(node)
        return next((d for d in n.diagnostics if d["code"] == code), None) if n else None

    def close(self) -> None:
        self.storage.stop()


class Feeder(_Base):
    """직접 만든 data 줄을 일정 간격으로 넣는다 (규칙 하나씩 시험)."""

    def __init__(self, tmp_path: Path, node: str = "Z1", src: str = "COM5", **info: Any) -> None:
        super().__init__(tmp_path)
        self.node, self.src = node, src
        self.seq = 0
        self.hub.port_opened[src] = self.clock.now() - 3600  # 포트는 오래전에 열림
        self.hub.process_line(src, info_line(node, **info))

    def line(self, text: str) -> None:
        self.hub.process_line(self.src, text)

    def data(self, **over: Any) -> None:
        """값 대신 함수(seq → 값)를 주면 매번 계산한다."""
        self.seq += 1
        vals = {k: (v(self.seq) if callable(v) else v) for k, v in over.items()}
        self.line(data_line(self.node, seq=self.seq, **vals))

    def evt(self, ev: str, **kw: Any) -> None:
        self.line(evt_line(self.node, ev, **kw))

    def info(self, **over: Any) -> None:
        self.line(info_line(self.node, **over))

    def run(self, seconds: float, every: float = 5.0, tick: float = 1.0, **over: Any) -> None:
        """seconds 동안 every초마다 data(**over)를 넣고 tick초마다 타이머를 돌린다."""
        t_end = self.clock.now() + seconds
        next_data = self.clock.now() + tick
        while self.clock.now() < t_end - 1e-9:
            self.clock.advance(tick)
            if self.clock.now() >= next_data - 1e-9:
                self.data(**over)
                next_data += every
            self.hub.tick()

    def wait(self, seconds: float) -> None:
        """data 없이 시간만 흐른다."""
        for _ in range(int(seconds)):
            self.clock.advance(1.0)
            self.hub.tick()


class Sim(_Base):
    """mock 노드(가짜 ESP32)를 가짜 시간으로 돌린다 (시나리오 검수)."""

    def __init__(self, tmp_path: Path, nodes: tuple[str, ...] = ("Z1",), seed: int = 7) -> None:
        super().__init__(tmp_path)
        now = self.clock.now()
        self.mocks = {k: MockNode(k, 1.0, now, random.Random(seed + i)) for i, k in enumerate(nodes)}
        for k, mn in self.mocks.items():
            self.hub.port_opened[f"mock:{k}"] = now
            self.feed(k, mn.boot_lines(now))

    def feed(self, key: str, lines: list[str]) -> None:
        for line in lines:
            self.hub.process_line(f"mock:{key}", line)

    def run(self, seconds: float, step: float = 1.0) -> None:
        t_end = self.clock.now() + seconds
        while self.clock.now() < t_end - 1e-9:
            self.clock.advance(step)
            now = self.clock.now()
            for k, mn in self.mocks.items():
                self.feed(k, mn.poll(now))
            self.hub.tick()

    def cmd(self, key: str, text: str) -> None:
        self.feed(key, self.mocks[key].handle(text, self.clock.now()))

    def scenario(self, key: str, name: str) -> None:
        self.feed(key, self.mocks[key].set_scenario(name, self.clock.now()))
