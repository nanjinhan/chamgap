@echo off
chcp 65001 >nul
rem 참값 브리지 서버 실행 (Windows). 예: run_server.bat --mode serial
rem 처음 한 번은 가상환경을 만들고 패키지를 설치합니다.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [준비] 가상환경을 만들고 패키지를 설치합니다...
  python -m venv .venv || goto :error
  ".venv\Scripts\python.exe" -m pip install -q --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || goto :error
)
if not exist "config.yaml" copy /y config.example.yaml config.yaml >nul
".venv\Scripts\python.exe" -m chamgap %*
goto :eof
:error
echo 설치에 실패했어요. Python 3.11 이상이 설치되어 있는지 확인하세요.
pause
