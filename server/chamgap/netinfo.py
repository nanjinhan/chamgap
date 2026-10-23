"""시작할 때 LAN 접속 주소를 크게 보여 준다 (SRV-11). 같은 WiFi의 폰에서 열 수 있게."""

from __future__ import annotations

import contextlib
import socket
import unicodedata

from . import __version__
from .config import Config


def lan_ips() -> list[str]:
    """이 노트북의 LAN IPv4 주소들 (인터넷이 없어도 동작)."""
    ips: list[str] = []
    # 기본 경로 쪽 주소: UDP connect는 실제로 보내지 않는다
    for probe in ("10.255.255.255", "192.168.255.255", "8.8.8.8"):
        with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((probe, 1))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127.") and ip != "0.0.0.0" and ip not in ips:
                ips.append(ip)
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str(info[4][0])
            if not ip.startswith(("127.", "169.254.")) and ip not in ips:
                ips.append(ip)
    return ips


def urls(port: int, ips: list[str] | None = None) -> list[str]:
    return [f"http://{ip}:{port}" for ip in (ips if ips is not None else lan_ips())]


def banner(cfg: Config, web_built: bool) -> str:
    port = cfg.server.port
    lan = urls(port)
    mode = {"mock": f"mock (가짜 ESP32 3대, 속도 ×{cfg.mock.speed:g})", "serial": "serial (USB)",
            "mqtt": f"mqtt ({cfg.mqtt.host}:{cfg.mqtt.port})"}[cfg.mode]
    lines = [
        f"참값 브리지 서버 {__version__}",
        f"연결 방식: {mode}",
        "",
    ]
    if web_built:
        lines.append(f"웹앱: http://localhost:{port}")
        lines += [f"웹앱: {u}  (같은 WiFi의 폰에서 열기)" for u in lan]
    else:
        lines.append("웹앱: 아직 빌드 안 됨 → 개발 중이면 web 폴더에서 npm run dev 후 :5173")
        lines += [f"      폰: http://{u.split('//')[1].split(':')[0]}:5173" for u in lan]
    lines += [
        f"API 문서: http://localhost:{port}/docs",
        "",
        "PIN: 켜짐 (급수·보정에 필요, 정지는 항상 가능)" if cfg.server.pin else "PIN: 꺼짐",
        "시험 모드 명령(/api/raw): " + ("켜짐" if cfg.server.allow_raw else "꺼짐"),
        "끄려면 Ctrl+C",
    ]
    width = max(_width(x) for x in lines) + 4
    out = ["┏" + "━" * width + "┓"]
    out += ["┃  " + x + " " * (width - 2 - _width(x)) + "┃" for x in lines]
    out.append("┗" + "━" * width + "┛")
    return "\n".join(out)


def _width(s: str) -> int:
    """터미널 표시 폭 (한글은 2칸)."""
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in s)
