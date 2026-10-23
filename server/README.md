# 참값 브리지 서버

ESP32 3대(구역 Z1·Z2·Z3)의 센서 값을 받아 **"이 값을 믿어도 되는지"를 진단**하고, 웹앱에 실시간으로 보내고, 웹앱의 급수 요청을 안전 검사 후 ESP32로 전달합니다.
기준 문서는 `../docs/01_requirements.md`(요구사항지시서)입니다. 코드와 지시서가 다르면 지시서가 우선입니다.

```
ESP32 ──USB 시리얼 / WiFi MQTT──▶ 브리지 서버 (진단·기록·안전 검사) ──REST + WebSocket──▶ 웹앱
```

## 빠른 시작

### Windows
```bat
cd server
run_server.bat                    :: 처음 한 번은 가상환경을 만들고 설치까지 합니다 (mock 모드)
run_server.bat --mode serial      :: ESP32를 USB로 꽂았을 때
```

### macOS
```bash
cd server
./run_server.sh
./run_server.sh --mode serial
```

### 직접 설치하기
```bash
cd server
python -m venv .venv
.venv\Scripts\activate            # macOS: source .venv/bin/activate
pip install -r requirements.txt
copy config.example.yaml config.yaml   # macOS: cp
python -m chamgap --mode mock --mock-speed 5
```

시작하면 콘솔에 접속 주소가 크게 나옵니다. 브라우저에서 `http://localhost:8000/docs`를 열면 API를 직접 눌러 볼 수 있습니다.

## 실행 옵션

| 옵션 | 뜻 | 예 |
|---|---|---|
| `--mode` | 연결 방식 `mock` · `serial` · `mqtt` | `--mode serial` |
| `--port` | 시리얼 포트 (여러 번 가능). 비우면 ESP32 USB 칩으로 자동 탐색 | `--port COM5 --port COM6` |
| `--mock-speed` | mock 속도 배수. 5면 data 1초마다, 진단 유지 시간도 1/5 | `--mock-speed 5` |
| `--scenario` | mock 고장 시나리오를 켜고 시작 | `--scenario Z2=soil_a_unplugged` |
| `--mqtt-host`, `--mqtt-port` | MQTT 브로커 | `--mqtt-host 127.0.0.1` |
| `--http-port` | 웹 서버 포트 (기본 8000) | `--http-port 8080` |
| `--no-raw` | 시험 모드 `/api/raw` 끄기 (시연용) | |
| `--pin` | 4자리 PIN. 급수·보정 명령에 필요, **정지는 항상 PIN 없이** | `--pin 1234` |
| `-v` | 자세한 로그 | |

`config.yaml`(→ `config.example.yaml` 참고)의 값보다 명령줄 옵션이 우선합니다.

## mock 모드 (하드웨어 없이 개발하기)

가짜 ESP32 3대가 그럴듯한 값을 만들고, 명령에 펌웨어와 똑같이 응답합니다.

- 온도 23±1.5°C(하루 주기), 습도는 온도와 반대로 움직이고, B 센서는 A보다 +0.2°C·−0.5%입니다.
- 토양은 시간당 −0.004씩 마르고, 급수하면 30~90초에 걸쳐 오릅니다.
- 무게는 증발로 시간당 −3g씩 줄고, 급수하면 몇 초 뒤 늘어납니다.
- **Z3는 유량 보정 전**(`pump_mlps=0`)으로 시작하므로 `FLOW_UNCAL`과 유량 보정 마법사를 볼 수 있습니다.
- `tare`를 보내면 90초 동안 빈 판(0g), `cal 500`을 보내면 60초 동안 500g으로 보입니다 (보정 마법사 시연용).

고장 재현은 `POST /api/mock/scenario {"node":"Z2","scenario":"sht_b_dead"}`, 웹앱 설정 화면, 또는 시작 옵션 `--scenario`로 켭니다. `normal`로 되돌립니다.

| 시나리오 | 하는 일 | 떠야 하는 진단 |
|---|---|---|
| `normal` | 정상으로 되돌림 | (없음) |
| `offline` | 그 구역 메시지 중단 | `NODE_OFFLINE` |
| `sht_b_dead` | `sht_b_ok=0`, B 값 null | `SHT_NO_RESP` |
| `sht_b_hot` | B 온도 +3°C | `SHT_AB_DIFF` (10분 유지, ×5면 2분) |
| `soil_a_unplugged` | `soil_a_mv` 5~20, `soil_a` null | `SOIL_WIRE` |
| `soil_ab_diff` | B를 A보다 0.35 낮게 | `SOIL_AB_DIFF` (10분 유지, ×5면 2분) |
| `lc_dead` | `hx_ok=0`, 무게 null | `LC_NO_RESP` |
| `lc_noisy` | 흔들림 8~12g | `LC_NOISY` (2분 유지) |
| `estop_pressed` | v12 0.0, 펌프 거부(`no_12v`), 켜져 있으면 끔 | `V12_MISSING` |
| `water_clog` | 펌프는 돌지만 무게·토양이 안 오름 | `WATER_NOT_ARRIVED` (급수 후 2분) |
| `leak` | 누수 센서 켬, `leak=1`, 펌프 거부(`leak`) | `LEAK` |

이 표는 `tests/test_scenarios.py`·`tests/test_readme.py`가 실제로 확인합니다 (검수 기준).

## 진단

- 규칙 24개는 `chamgap/diagnostics/rules.py`, 한국어 문구는 `chamgap/diagnostics/texts.py`에 있습니다.
- 기준값은 **`chamgap/diagnostics/diagnostics.yaml` 한 파일**에 있습니다. 고친 뒤 서버를 재시작하지 않고 `POST /api/diagnostics/reload`로 다시 읽습니다.
- 순간 튐으로 깜빡이지 않게 규칙마다 유지 시간(`hold_s`)이 있고, 정상이 `clear_s`(최소 10초)만큼 이어져야 해제됩니다.
- 한 원인이 여러 증상을 만들면 원인 하나만 보여 줍니다. 예: 오프라인이면 그 구역의 다른 진단을 숨기고, 12V가 없으면 "급수 거부(no_12v)"를 숨깁니다.

## 안전

- 급수 요청은 ESP32로 보내기 전에 차례로 검사합니다: 구역 연결 → 펌프 꺼짐 → 1~50mL → 하루 300mL → 유량 보정 → 누수 → 12V → 무게 센서. 결과는 `GET /api/nodes/Z1/water/preflight?ml=10`으로 미리 볼 수 있습니다.
- 펌프를 켤지 마지막으로 정하는 것은 ESP32입니다. 하드웨어 비상정지 스위치가 항상 소프트웨어보다 우선합니다.
- `stop`은 대기열을 건너뛰고 즉시 보냅니다. `/api/stop-all`은 PIN 없이 항상 동작합니다.
- 웹에서 `pump` 명령을 보내는 길은 유량 보정(`/api/nodes/{node}/flow-cal/run`) 하나뿐입니다.

## API 요약

| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/api/state` | 전체 현재 상태 |
| GET | `/api/nodes/{node}` | 한 구역 + 최근 메시지 |
| GET | `/api/history?node=Z1&metric=temp_a,temp_b&minutes=60&bucket=60` | 그래프용 시계열 |
| GET | `/api/events?node=Z1&limit=100&kind=diag_off` | 사건 기록 |
| GET | `/api/diagnostics` | 지금 활성인 진단 전부 |
| POST | `/api/nodes/{node}/water` `{"ml":10}` | 급수 |
| POST | `/api/nodes/{node}/stop`, `/api/stop-all` | 정지 |
| POST | `/api/nodes/{node}/command` `{"cmd":"tare"}` | 그 밖의 명령 (허용 목록) |
| GET | `/api/nodes/{node}/water/preflight?ml=10` | 급수 전 점검 미리 보기 |
| POST | `/api/nodes/{node}/flow-cal/run` `{"ms":10000}` | 유량 보정용 펌프 + 전후 무게 |
| POST | `/api/mark` `{"node":"Z1","note":"..."}` | 메모 |
| GET | `/api/export.csv?node=Z1&from=2026-10-23&to=2026-10-23` | CSV (엑셀용 BOM) |
| GET | `/api/link` | 연결 상태, 접속 주소 |
| POST | `/api/raw` `{"src":"COM5","text":"air a"}` | 시험 모드 전용 |
| POST | `/api/diagnostics/reload` | 기준값 다시 읽기 |
| POST | `/api/mock/scenario` | mock 고장 재현 |
| WS | `/ws` | snapshot → data/evt/ack/diag/link/log/test, 15초마다 ping |

오류 응답은 항상 `{"ok": false, "error": "code", "message": "한국어 설명"}`입니다.

서버가 만든 사건도 WebSocket `evt`로 보냅니다: `payload.t`가 `water_result`(급수 결과), `mark`(메모), `info`(설정·보정 상태)입니다.

## 기록 파일

- `logs/YYYY-MM-DD/all.jsonl`: 받은 메시지 원본 전부 + 서버가 만든 사건 (`t`가 `_server`·`_log`·`_tx`)
- `data/chamgap.sqlite3`: `samples`(측정값), `events`(사건). 30일 지난 측정값은 시작할 때 지웁니다 (`storage.keep_days`)

## 웹앱을 같이 띄우기 (시연용)

`web` 폴더에서 `npm run build`를 하면 `web/dist`가 생기고, 서버가 `http://<노트북IP>:8000`에서 웹앱까지 함께 보여 줍니다. 서버만 켜면 됩니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `ESP32 USB 포트를 찾지 못했어요` | USB 케이블이 데이터용인지, 드라이버(CP210x·CH340)가 설치됐는지. 장치 관리자 → 포트(COM & LPT)에서 번호를 보고 `--port COM5`로 지정 |
| `다른 프로그램이 포트를 쓰고 있어요` (Access denied) | 아두이노 IDE의 **시리얼 모니터를 닫으세요**. 포트는 한 프로그램만 열 수 있습니다 |
| 서버를 켤 때마다 `NODE_REBOOTED` | 포트를 열면 ESP32가 리셋되는 것이 정상이라 15초 안의 재시작은 무시합니다. 그 뒤에도 계속되면 전원 문제입니다 |
| 폰에서 접속이 안 됨 | 노트북과 폰이 **같은 WiFi**인지. 처음 실행할 때 뜨는 **Windows 보안 경고에서 "개인 네트워크" 허용**. 이미 막았다면 Windows 방화벽 → 앱 허용에서 python.exe를 허용 |
| MQTT `브로커에 연결할 수 없어요` | Mosquitto가 실행 중인지 (`net start mosquitto`). Mosquitto 2.x는 기본으로 localhost만 받으므로 `mosquitto.conf`에 `listener 1883 0.0.0.0`과 `allow_anonymous true`를 넣어야 ESP32가 붙습니다 |
| 콘솔 한글이 깨짐 | Windows Terminal 또는 VS Code 터미널을 쓰세요. `run_server.bat`은 `chcp 65001`을 자동으로 겁니다 |
| 진단 기준을 바꾸고 싶음 | `diagnostics.yaml`을 고치고 `POST /api/diagnostics/reload` |

## 시험

```bash
pip install -r requirements-dev.txt   # MQTT 왕복 시험용 브로커(amqtt) 포함
pytest                                # 진단 규칙 24개 + mock 시나리오 + API + 저장 + WebSocket
ruff check .
```

시간은 주입 가능한 `Clock`으로 다루므로, 10분·6시간짜리 유지 시간도 테스트에서 건너뜁니다.

## 하드웨어 확인이 필요한 것 (TODO)

코드 안의 `TODO(확인 필요):` 주석과 같습니다. 펌웨어(`firmware/node/node.ino`)를 받으면 맞춰 보세요.

1. `status`·`info` 명령의 응답이 `data`/`info`만인지, `ack`도 오는지 (지시서 4.2절과 4.3절이 다름). 서버는 둘 다 받아들입니다.
2. `pump_off`의 `ml`이 예상 mL인지, 실제 켜진 시간 기준 mL인지. 서버는 예상 mL로 보고 `ran/dur` 비율을 곱합니다.
3. `info`의 `soil_cal`이 A·B 공통 하나인지. 채널별 `soil_a_cal`·`soil_b_cal`이 오면 그것을 씁니다.
4. `boot` 사건의 `reset` 번호가 `esp_reset_reason()` 기준인지 (9 = 브라운아웃으로 안내).
5. 유량 보정 전 `water` 명령에 펌웨어가 무엇을 돌려주는지 (mock은 `ack ok=0 msg=flow_uncal`).
