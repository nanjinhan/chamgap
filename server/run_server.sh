#!/usr/bin/env bash
# 참값 브리지 서버 실행 (macOS/Linux). 예: ./run_server.sh --mode serial
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "[준비] 가상환경을 만들고 패키지를 설치합니다..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -q -r requirements.txt
fi
[ -f config.yaml ] || cp config.example.yaml config.yaml
exec .venv/bin/python -m chamgap "$@"
