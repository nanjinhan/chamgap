"""USB 시리얼 링크 (1단계). 포트마다 읽기 스레드 하나. 끊기면 2초마다 다시 연결 (SRV-04)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from typing import Any

import serial
from serial.tools import list_ports

from .base import LineCallback, Link, StatusCallback

log = logging.getLogger("chamgap.serial")

# ESP32 보드의 USB 칩 (SRV-03)
ESP32_VIDS: dict[int, str] = {0x10C4: "CP210x", 0x1A86: "CH340", 0x303A: "ESP32 USB", 0x0403: "FTDI"}
RETRY_S = 2.0
MAX_LINE = 4096


def find_esp32_ports() -> list[tuple[str, str]]:
    """(포트 이름, 설명) 목록."""
    out: list[tuple[str, str]] = []
    for p in list_ports.comports():
        if p.vid in ESP32_VIDS:
            out.append((p.device, f"{ESP32_VIDS[p.vid]} {p.description or ''}".strip()))
    return sorted(out)


def _hint_for(err: str) -> str | None:
    low = err.lower()
    if any(k in low for k in ("access is denied", "permissionerror", "거부", "errno 13", "busy", "errno 16")):
        return "다른 프로그램이 포트를 쓰고 있어요. 아두이노 시리얼 모니터를 닫으세요"
    if any(k in low for k in ("filenotfound", "could not open port", "지정된 파일", "no such file")):
        return "포트가 없어요. USB 케이블을 확인하세요"
    return None


class _PortWorker(threading.Thread):
    def __init__(
        self,
        port: str,
        baud: int,
        on_line: LineCallback,
        on_status: StatusCallback | None,
        stop_event: threading.Event,
        desc: str = "",
    ) -> None:
        super().__init__(name=f"serial-{port}", daemon=True)
        self.port = port
        self.baud = baud
        self.desc = desc
        self.on_line = on_line
        self.on_status = on_status
        self.stop_event = stop_event
        self.connected = False
        self.error: str | None = None
        self.hint: str | None = None
        self._ser: serial.SerialBase | None = None
        self._wlock = threading.Lock()

    def status(self) -> dict[str, Any]:
        return {"port": self.port, "connected": self.connected, "desc": self.desc,
                "error": self.error, "hint": self.hint}

    def _notify(self, event: str) -> None:
        if self.on_status:
            self.on_status({"event": event, "port": self.port, "error": self.error, "hint": self.hint})

    def run(self) -> None:
        last_error = None
        while not self.stop_event.is_set():
            try:
                ser = serial.serial_for_url(self.port, self.baud, timeout=0.2)
            except (serial.SerialException, OSError, ValueError) as e:
                self.error = str(e)
                self.hint = _hint_for(self.error)
                if self.error != last_error:
                    log.warning("%s 열기 실패: %s%s", self.port, self.error, f" → {self.hint}" if self.hint else "")
                    self._notify("port_error")
                    last_error = self.error
                self.stop_event.wait(RETRY_S)
                continue
            self._ser = ser
            self.connected, self.error, self.hint, last_error = True, None, None, None
            log.info("%s 연결됨", self.port)
            self._notify("port_connected")
            try:
                self._read_loop(ser)
            except (serial.SerialException, OSError) as e:
                self.error = str(e)
                self.hint = _hint_for(self.error)
            finally:
                with self._wlock:
                    self._ser = None
                with contextlib.suppress(serial.SerialException, OSError):
                    ser.close()
                if self.connected:
                    self.connected = False
                    log.warning("%s 끊김%s", self.port, f": {self.error}" if self.error else "")
                    self._notify("port_disconnected")
            self.stop_event.wait(RETRY_S)

    def _read_loop(self, ser: serial.SerialBase) -> None:
        buf = bytearray()
        while not self.stop_event.is_set():
            chunk = ser.read(ser.in_waiting or 1)
            if not chunk:
                continue
            buf.extend(chunk)
            while True:
                i = buf.find(b"\n")
                if i < 0:
                    break
                raw = bytes(buf[:i])
                del buf[: i + 1]
                self.on_line(self.port, raw.decode("utf-8", errors="replace").rstrip("\r"))
            if len(buf) > MAX_LINE:  # 줄 끝 없이 쌓이면 버린다
                buf.clear()

    def write(self, text: str) -> bool:
        with self._wlock:
            if self._ser is None:
                return False
            try:
                self._ser.write((text.rstrip("\n") + "\n").encode("utf-8"))
                return True
            except (serial.SerialException, OSError) as e:
                log.warning("%s 쓰기 실패: %s", self.port, e)
                return False


class SerialLink(Link):
    mode = "serial"

    def __init__(self, ports: list[str], baud: int = 115200) -> None:
        self.fixed_ports = list(ports)
        self.baud = baud
        self._workers: dict[str, _PortWorker] = {}
        self._stop = threading.Event()
        self._scanner: threading.Thread | None = None
        self._on_line: LineCallback | None = None
        self._on_status: StatusCallback | None = None
        self._lock = threading.Lock()

    @property
    def auto(self) -> bool:
        return not self.fixed_ports

    async def start(self, on_line: LineCallback, on_status: StatusCallback | None = None) -> None:
        self._on_line, self._on_status = on_line, on_status
        self._stop.clear()
        if self.auto:
            self._scanner = threading.Thread(target=self._scan_loop, name="serial-scan", daemon=True)
            self._scanner.start()
        else:
            for p in self.fixed_ports:
                self._add_worker(p, "")

    def _add_worker(self, port: str, desc: str) -> None:
        assert self._on_line is not None
        with self._lock:
            if port in self._workers:
                return
            w = _PortWorker(port, self.baud, self._on_line, self._on_status, self._stop, desc)
            self._workers[port] = w
        w.start()

    def _scan_loop(self) -> None:
        announced_empty = False
        while not self._stop.is_set():
            try:
                found = find_esp32_ports()
            except Exception:
                log.exception("포트 탐색 실패")
                found = []
            for port, desc in found:
                if port not in self._workers:
                    log.info("ESP32 포트 발견: %s (%s)", port, desc)
                    self._add_worker(port, desc)
            if not found and not self._workers and not announced_empty:
                log.warning("ESP32 USB 포트를 찾지 못했어요. 케이블을 꽂거나 --port COM5 처럼 지정하세요")
                announced_empty = True
            self._stop.wait(RETRY_S)

    async def stop(self) -> None:
        self._stop.set()
        workers = list(self._workers.values())
        await asyncio.to_thread(lambda: [w.join(timeout=2) for w in workers])

    async def send(self, node: str | None, src: str | None, text: str) -> bool:
        w = self._workers.get(src or "")
        if w is None:
            return False
        return await asyncio.to_thread(w.write, text)

    def status(self) -> dict[str, Any]:
        with self._lock:
            ports = [w.status() for w in self._workers.values()]
        return {"mode": "serial", "auto": self.auto, "baud": self.baud, "ports": sorted(ports, key=lambda p: p["port"])}

    def sources(self) -> list[str]:
        return [p for p, w in self._workers.items() if w.connected]
