"""실행: python -m chamgap --mode mock|serial|mqtt [--port COM5 ...]"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import uvicorn

from .api import create_app
from .config import load_config
from .netinfo import banner


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m chamgap", description="참값 브리지 서버")
    p.add_argument("--mode", choices=["mock", "serial", "mqtt"], help="연결 방식 (기본: config.yaml)")
    p.add_argument("--port", action="append", dest="ports", metavar="COM5",
                   help="시리얼 포트. 여러 개면 여러 번 (비우면 자동 탐색)")
    p.add_argument("--baud", type=int, help="시리얼 속도 (기본 115200)")
    p.add_argument("--config", type=Path, help="설정 파일 (기본 server/config.yaml)")
    p.add_argument("--mock-speed", type=float, help="mock 속도 배수 (5면 data 1초마다)")
    p.add_argument("--scenario", action="append", metavar="Z2=soil_a_unplugged",
                   help="mock 고장 시나리오 (여러 번 가능)")
    p.add_argument("--mqtt-host", help="MQTT 브로커 주소")
    p.add_argument("--mqtt-port", type=int, help="MQTT 브로커 포트")
    p.add_argument("--host", help="웹 서버 주소 (기본 0.0.0.0)")
    p.add_argument("--http-port", type=int, help="웹 서버 포트 (기본 8000)")
    p.add_argument("--no-raw", action="store_true", help="시험 모드 /api/raw 끄기 (시연용)")
    p.add_argument("--pin", help="4자리 PIN (급수·보정 명령에 필요)")
    p.add_argument("-v", "--verbose", action="store_true", help="자세한 로그")
    return p


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname).1s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    try:
        cfg = load_config(args=args)
    except ValueError as e:
        print(f"설정 오류: {e}", file=sys.stderr)
        sys.exit(2)
    try:
        app = create_app(cfg)
    except ValueError as e:  # 시나리오 이름, diagnostics.yaml 오류 등
        print(f"시작 실패: {e}", file=sys.stderr)
        sys.exit(2)
    print(banner(cfg, (cfg.web_dist / "index.html").exists()), flush=True)
    uvicorn.run(app, host=cfg.server.host, port=cfg.server.port, log_level="warning")


if __name__ == "__main__":
    main()
