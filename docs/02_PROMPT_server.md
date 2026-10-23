# VS Code 프롬프트 ① — 참값 브리지 서버 (Python)

> **사람이 읽는 부분 — 쓰는 법**
> 1. 프로젝트 폴더 구조를 이렇게 만듭니다:
>    `chamgap/docs/` (이 파일과 `01_요구사항지시서.md`), `chamgap/firmware/`, `chamgap/server/`(비어 있음), `chamgap/web/`(비어 있음)
> 2. VS Code로 `chamgap` 폴더를 열고, AI 채팅(Copilot Agent 모드, Claude Code 등)에 아래 **"AI에게"부터 끝까지** 붙여넣습니다.
> 3. 한 번에 다 시키지 말고 **"마일스톤 S1만 해줘"**처럼 하나씩 시킵니다. 각 마일스톤 끝의 **확인 방법**을 직접 해보고, 통과하면 다음으로 넘어갑니다.
> 4. 웹앱(프롬프트 ②)은 이 서버의 S4(mock 모드)가 끝난 뒤 시작합니다.

---

## AI에게

너는 이 프로젝트의 백엔드 개발자다. ESP32 3대(구역 Z1·Z2·Z3)에서 오는 센서 데이터를 받아 **"이 값을 믿어도 되는지" 진단**하고, 웹앱에 실시간으로 보내고, 웹앱의 급수 요청을 안전하게 ESP32로 전달하는 **브리지 서버**를 `server/` 폴더에 만든다.

### 0. 반드시 지킬 것

1. **먼저 `docs/01_요구사항지시서.md`를 처음부터 끝까지 읽어라.** 특히 4장(통신 규약), 5장(서버), 6장(진단), 7장(안전)이 이 작업의 기준이다. 이 프롬프트와 지시서가 다르면 **지시서가 우선**이고, 다른 점을 나에게 알려라.
2. **통신 규약(4장)을 바꾸지 마라.** ESP32 펌웨어는 이미 그 형식으로 동작한다. 키 이름, 명령 문법, 줄 끝(`\n`)을 그대로 쓴다. `firmware/node/node.ino`가 있으면 읽어서 확인해라.
3. **진단 판단은 서버에서만** 한다. 웹앱에는 결과(코드·단계·한국어 문구)만 보낸다.
4. 한 번에 **마일스톤 하나만** 한다. 끝나면 무엇을 만들었는지, 내가 확인할 방법을 짧게 말하고 멈춘다.
5. 모르는 하드웨어 동작은 추측해서 채우지 말고 `TODO(확인 필요):` 주석과 함께 나에게 묻는다.
6. Windows 10/11에서 먼저 동작해야 한다 (macOS도). 경로는 `pathlib`, 줄바꿈·인코딩은 UTF-8 명시.
7. 사용자에게 보이는 문구(진단 제목·설명·원인·확인 방법, 오류 메시지)는 **한국어**. 코드·변수·로그 키는 영어.

### 1. 기술 스택 (바꾸지 말 것)

| 용도 | 선택 |
|---|---|
| 언어 | Python 3.11 이상 |
| 웹 서버 | FastAPI + Uvicorn (`uvicorn[standard]`) |
| 시리얼 | pyserial |
| MQTT | paho-mqtt 2.x (`CallbackAPIVersion.VERSION2`) |
| 데이터 검증 | pydantic v2 |
| 설정 | PyYAML (`config.yaml`, `diagnostics.yaml`) |
| 저장 | 표준 `sqlite3` (WAL 모드) + JSONL 파일 |
| 시험 | pytest, httpx (FastAPI TestClient) |

`requirements.txt`에 버전 하한을 적는다. 가상환경 사용법(`python -m venv .venv` → Windows `.venv\Scripts\activate`)을 README에 쓴다.

### 2. 폴더 구조

```
server/
├─ README.md                  실행법, 설정, mock 시나리오, 문제 해결
├─ requirements.txt
├─ config.example.yaml        → 복사해서 config.yaml
├─ run_server.bat / run_server.sh
├─ chamgap/
│  ├─ __init__.py
│  ├─ __main__.py             python -m chamgap --mode mock|serial|mqtt [--port COM5 ...]
│  ├─ config.py               설정 읽기 (yaml + 명령줄 옵션 덮어쓰기)
│  ├─ protocol.py             줄 해석, 메시지 모델, 명령 문자열 만들기
│  ├─ links/
│  │  ├─ base.py              Link 추상 클래스
│  │  ├─ serial_link.py
│  │  ├─ mqtt_link.py
│  │  └─ mock_link.py         가짜 ESP32 3대 (물리 흉내 + 고장 시나리오)
│  ├─ hub.py                  중심: 메시지 받기 → 상태 갱신 → 진단 → 저장 → 방송
│  ├─ state.py                NodeState, PumpState 등 (dataclass)
│  ├─ commands.py             구역별 명령 대기열, ack 기다리기, 시간 초과
│  ├─ safety.py               급수 전 검사 (지시서 SAFE-03, SAFE-04)
│  ├─ diagnostics/
│  │  ├─ engine.py            규칙 실행, 유지 시간, 억제(DX-06)
│  │  ├─ rules.py             규칙 하나 = 클래스 하나
│  │  ├─ texts.py             한국어 문구 (제목·원인·확인 방법)
│  │  └─ diagnostics.yaml     기준값 (DX-03)
│  ├─ storage.py              SQLite + JSONL + CSV 내보내기
│  ├─ api.py                  REST 라우트
│  ├─ ws.py                   WebSocket 관리 (접속자 목록, 방송)
│  └─ netinfo.py              시작할 때 LAN 접속 주소 출력
├─ logs/                      (git 제외) 날짜별 all.jsonl
├─ data/                      (git 제외) chamgap.sqlite3
└─ tests/
   ├─ conftest.py
   ├─ test_protocol.py
   ├─ test_commands.py
   ├─ test_safety.py
   ├─ test_rules_*.py         규칙마다
   └─ test_api.py
```

### 3. 설계 규칙

**동시성 모델**
- 모든 상태 변경은 **asyncio 이벤트 루프 한 곳**에서만 일어난다.
- 시리얼 읽기는 포트마다 별도 스레드에서 하고, 받은 줄은 `loop.call_soon_threadsafe(queue.put_nowait, (src, line))`로 루프에 넘긴다.
- MQTT는 paho의 `loop_start()` 스레드에서 같은 방식으로 넘긴다.
- async 핸들러 안에서 막히는 호출(sqlite 쓰기, 파일 쓰기)은 `asyncio.to_thread` 또는 전용 쓰기 스레드 + 큐로 처리한다.

**Link 인터페이스** (`links/base.py`)
```python
class Link(ABC):
    mode: Literal["serial", "mqtt", "mock"]
    async def start(self, on_line: Callable[[str, str], None]) -> None: ...   # (src, line)
    async def stop(self) -> None: ...
    async def send(self, node: str | None, src: str | None, text: str) -> bool: ...
    def status(self) -> dict: ...   # /api/link 에 그대로 나감
```
- serial: 포트 지정이 없으면 VID로 자동 탐색(지시서 SRV-03). 끊기면 2초마다 재연결하고 `link` 이벤트를 방송한다. "Access denied"면 "아두이노 시리얼 모니터를 닫으세요"라는 힌트를 상태에 넣는다.
- serial 열 때 ESP32가 리셋될 수 있다. 그 결과로 오는 `boot` 사건은 정상 처리한다.
- mqtt: `chamgap/+/+` 구독. `online` 토픽은 `{"t":"online","node":X,"online":0|1}`로 바꿔서 넘긴다. `cmd` 토픽은 무시한다.
- 구역 → 경로 매핑은 hub가 메시지의 `node`를 보고 기억한다(SRV-06).

**protocol.py**
- `parse_line(src, line) -> ParsedMessage | LogLine`: `{`로 시작하면 JSON, 아니면 LogLine(`#` 메모 포함).
- JSON에 `pc_time`(로컬 시간대 ISO 8601, ms까지)과 `src`를 붙인다.
- 모르는 키는 그대로 보존한다 (pydantic `extra="allow"`).
- `node`가 없는 메시지는 **시험 모드 메시지**로 분류한다 (`t`가 i2c, sht, soil, soilcal, lc, lccal, pwr, pump, pumpcal, evt).
- 명령 만들기 함수: `cmd_water(ml)`, `cmd_pump(ms)`, `cmd_stop()`, `cmd_tare()`, `cmd_cal(g)`, `cmd_soilcal(ch, kind)`, `cmd_flow(ms, g)`, `cmd_interval(ms)`, `cmd_info()`, `cmd_status()`.
- 웹에서 오는 임의 명령은 **허용 목록**(help, status, info, tare, cal, soilcal, flow, interval, id, reboot)만 통과시킨다. `pump`·`water`·`stop`은 전용 API로만 보낸다.

**commands.py (COM-10, COM-11)**
- 구역마다 asyncio 큐 하나. **한 번에 하나만** 보내고, 같은 `cmd` 이름의 `ack`가 오면 완료한다.
- 시간 제한: 기본 3초, `tare`·`cal`은 5초. 시간이 지나면 `{"ok":false,"error":"timeout"}`.
- `stop`은 큐를 건너뛰고 즉시 보낸다. 같은 구역의 대기 중인 `water`/`pump`는 취소한다.
- 결과는 `CommandResult(ok, ack: dict | None, error: str | None, message_ko: str)`.

**safety.py (SAFE-03, SAFE-04)**
급수 요청 `water(node, ml)`을 ESP32로 보내기 전에 아래를 **순서대로** 검사하고, 실패하면 보내지 않고 이유를 돌려준다:

| 순서 | 검사 | 실패 코드 | 한국어 메시지 |
|---|---|---|---|
| 1 | 구역 온라인 | `offline` | Z1이 연결되어 있지 않아요 |
| 2 | 펌프 꺼짐 | `pump_on` | 이미 급수 중이에요 |
| 3 | 0 < ml ≤ 50 | `bad_ml` | 한 번에 1~50mL만 줄 수 있어요 |
| 4 | 오늘 합계 + ml ≤ 300 | `daily_limit` | 오늘 급수 한도(300mL)를 넘어요 (지금 280mL) |
| 5 | `info.pump_mlps` > 0 | `flow_uncal` | 유량 보정이 먼저 필요해요 |
| 6 | 활성 진단에 `LEAK` 없음 | `leak` | 누수가 감지되어 급수를 막았어요 |
| 7 | 활성 진단에 `V12_MISSING` 없음 | `no_12v` | 12V가 없어요 (비상정지·퓨즈 확인) |
| 8 | 활성 진단에 `LC_NO_RESP` 없음 | `scale_dead` | 무게 센서가 응답하지 않아 급수 결과를 확인할 수 없어요 |

한도(50, 300)는 `config.yaml`의 `safety:` 아래에 둔다. "오늘"은 노트북 로컬 날짜 기준이다. `GET /api/nodes/{node}/water/preflight?ml=10`으로 검사 결과만 미리 볼 수 있게 한다. 웹앱의 "켜기 전 점검" 목록이 이걸 쓴다.

**hub.py — 메시지 처리 순서**
1. 해석 → JSONL에 원본 기록
2. `node`가 있으면 그 구역 상태 갱신 (`latest`, `info`, `last_seen`, `pump`)
3. `evt`면 펌프 상태와 오늘 급수량을 갱신하고, `pump_off(done)`이면 **급수 추적**(4번)을 시작한다
4. **급수 추적**: 급수 시작 직전의 안정된 무게(sd ≤ 3g, 최근 3개 중앙값)를 기억한다. 끝난 뒤 2분 동안 안정된 무게를 보며 증가량을 계산해 `WATER_NOT_ARRIVED`·`WATER_OVER`·`SOIL_NO_RISE` 규칙의 입력으로 쓴다. 결과를 `events`에 `water_result`(예상 mL, 실제 g, 판정)로 남긴다.
5. 진단 엔진 실행 → 바뀐 진단이 있으면 `diag` 방송 + `events` 기록
6. `data`는 SQLite에 저장
7. WebSocket으로 `data` / `evt` / `ack` / `log` 방송
- 1초마다 도는 타이머로 `NODE_OFFLINE`과 시간 기반 규칙을 검사한다 (메시지가 안 와도 진단이 떠야 한다).

**state.py**
지시서 5.3절의 `/api/state` 형식을 그대로 만들 수 있는 dataclass. 센서 키는 `sht_a, sht_b, soil_a, soil_b, scale, pump, power`로 고정한다. 센서별 `status`는 그 센서에 걸린 진단 중 가장 나쁜 단계, 구역 `status`는 전체 중 가장 나쁜 단계(`ok < info < warn < fault < offline`).

### 4. 진단 엔진 (가장 중요)

**규칙 인터페이스**
```python
class Rule(ABC):
    code: str                 # "SHT_AB_DIFF"
    sensor: str               # "sht_b" 처럼 상태 키, 구역 전체면 "node"
    severity: Severity        # info | warn | fault | offline
    hold_s: float             # 조건이 이만큼 이어져야 켜짐 (DX-02)
    clear_s: float            # 정상이 이만큼 이어져야 꺼짐 (기본 hold_s와 같음, 최소 10초)
    def evaluate(self, ctx: RuleContext) -> RuleResult | None: ...
    # RuleResult(active: bool, detail_ko: str, values: dict)
```
- `RuleContext`에는 그 구역의 최신 data, info, 최근 N분 이력(메모리 링버퍼, 구역당 최대 6시간), 급수 추적 결과, 현재 시각이 들어 있다.
- 엔진은 규칙마다 `inactive → pending → active → clearing → inactive` 상태 기계를 돌린다.
- 시간 기반 규칙(`SHT_STUCK` 30분, `SOIL_STUCK` 6시간, `LC_DRIFT_UP` 1시간)은 이력 링버퍼로 판단한다. 서버가 재시작되면 SQLite에서 최근 6시간을 다시 채운다.
- **억제 규칙 (DX-06)**:
  - `NODE_OFFLINE`이면 그 구역의 다른 진단은 모두 숨긴다 (목록에서 빠지고 센서 status는 `offline`).
  - `V12_MISSING`이면 `WATER_NOT_ARRIVED`와 `PUMP_REFUSED(no_12v)`를 숨긴다.
  - `SHT_NO_RESP`이면 같은 센서의 `SHT_RANGE`, `SHT_AB_DIFF`, `SHT_STUCK`을 숨긴다.
  - `SOIL_WIRE`이면 같은 센서의 `SOIL_AB_DIFF`, `SOIL_NO_RISE`, `SOIL_STUCK`을 숨긴다.
  - `LC_NO_RESP`이면 `LC_*`, `WATER_*`를 숨긴다.
  - `*_UNCAL`(info)이 있으면 그 센서 값 비교 규칙(`*_AB_DIFF`)은 숨긴다.
- 기준값은 전부 `diagnostics.yaml`에서 읽는다 (지시서 6.3절의 값으로 시작). 파일을 고치면 서버 재시작 없이 `POST /api/diagnostics/reload`로 다시 읽는다.
- 문구는 `texts.py` 한 곳에. 지시서 6.3절의 "확인 방법"을 2~3개의 구체적인 행동 문장으로 풀어 쓴다. `detail_ko`에는 실제 숫자를 넣는다. 예: "B가 A보다 2.7°C 높음 (기준 1.0°C, 10분째)".
- 진단마다 `action`을 붙인다. 보정 관련이면 `{"label":"보정하기","to":"/calibrate/Z1/scale"}`, 센서 관련이면 `{"label":"센서 보기","to":"/zone/Z1/sensor/sht_b"}`.
- 진단 JSON 형식은 지시서 6.2절과 **똑같이** 맞춘다. `since`는 active가 된 시각이다.

**규칙 목록**: 지시서 6.3절의 24개를 전부 구현한다. 하나라도 빼면 안 된다.

### 5. mock 모드 (`links/mock_link.py`) — 하드웨어 없이 개발하기

- 구역 3개(Z1·Z2·Z3)가 각자 `sample_ms`(기본 5000, `--mock-speed 5`면 1000)마다 `data`를 만든다. 시작할 때 `boot`와 `info`를 보낸다.
- **값 흉내**:
  - 온도: 23±1.5°C 하루 주기 + 잡음 0.05
  - 습도: 45±5%, 온도와 반대로 움직임
  - B 센서는 A + 작은 고정 오차(온도 +0.2, 습도 −0.5) + 잡음
  - 토양: 0.55에서 시작해 시간당 −0.004씩 줄고, 급수하면 30~90초에 걸쳐 `ml × 0.004`만큼 오른다
  - 무게: 1200g ± 구역별 차이, 시간당 −3g(증발), 급수하면 ml × (0.95~1.0)g이 10초에 걸쳐 오른다. sd 0.3~0.8g
  - v12 12.0±0.05, leak는 null (info의 `leak_sensor=0`)
  - mV 값(`soil_a_mv` 등)도 보정값으로 거꾸로 계산해 그럴듯하게 만든다
- **명령 응답은 펌웨어와 똑같이**: `water`/`pump`는 지시서의 거부 규칙(already_on, bad_ms 50~15000, cooldown 3초, no_12v)을 따르고 `evt` + `ack`를 보낸다. `pump_off(done)`은 시간이 지나면 보낸다. `stop`, `tare`(2초 지연), `cal`, `soilcal`, `flow`, `interval`, `info`, `status`도 응답한다. 보정 값은 메모리에 저장한다. Z3는 처음에 `pump_mlps=0`(유량 보정 전)으로 시작해서 `FLOW_UNCAL`을 볼 수 있게 한다.
- **고장 시나리오 (지시서 6.4)**: `normal, offline, sht_b_dead, sht_b_hot, soil_a_unplugged, soil_ab_diff, lc_dead, lc_noisy, estop_pressed, water_clog, leak`. `POST /api/mock/scenario {"node","scenario"}`와 시작 옵션 `--scenario Z2=soil_a_unplugged`로 켠다. `normal`로 되돌릴 수 있다.
  - `offline`: 그 구역 메시지 중단
  - `sht_b_dead`: `sht_b_ok=0`, 값 null
  - `sht_b_hot`: B 온도 +3°C
  - `soil_a_unplugged`: `soil_a_mv` 5~20, `soil_a` null
  - `soil_ab_diff`: B를 A보다 0.35 낮게
  - `lc_dead`: `hx_ok=0`, 무게 null
  - `lc_noisy`: sd 8~12g
  - `estop_pressed`: v12 0.0, 펌프 요청 거부(no_12v), 켜져 있으면 `pump_off(no_12v)`
  - `water_clog`: 펌프는 돌지만 무게·토양이 안 오름
  - `leak`: info `leak_sensor=1`, data `leak=1`, 펌프 거부(leak)
- 시나리오 목록과 각각 어떤 진단이 떠야 하는지 README에 표로 적는다.

### 6. 저장 (`storage.py`)

- `logs/YYYY-MM-DD/all.jsonl`: 받은 메시지 원본 + 서버가 만든 이벤트(진단 변화, 명령, 메모, 급수 결과). 날짜가 바뀌면 새 파일.
- SQLite `data/chamgap.sqlite3`:
  - `samples(id, node, ts REAL, pc_time TEXT, seq, temp_a, rh_a, temp_b, rh_b, soil_a, soil_b, soil_a_mv, soil_b_mv, weight_g, weight_sd, v12, leak, pump, raw_json)` + 인덱스 `(node, ts)`
  - `events(id, node, ts, kind, payload_json)`. kind: evt, ack, diag_on, diag_off, command, mark, water_result, link
- 이력 API는 `bucket`초 단위로 평균을 낸다: `GROUP BY CAST(ts / bucket AS INT)`. null은 평균에서 뺀다.
- 30일이 지난 samples는 시작할 때 지운다 (설정 가능).
- 쓰기는 전용 스레드 하나 + 큐로 모아서 1초마다 한 번에 커밋한다.

### 7. API

지시서 5.1, 5.2절을 그대로 구현한다. 아래를 추가한다:
- `GET /api/nodes/{node}/water/preflight?ml=10` → `{"ok":bool,"checks":[{"key","ok","label_ko","detail_ko"}]}`
- `POST /api/diagnostics/reload`
- `POST /api/nodes/{node}/flow-cal/run` `{"ms":10000}` — **유량 보정용 펌프 실행**. safety의 1·2·6·7번 검사만 하고(유량 보정 전이어도 됨, 1회 50~15000ms), ESP32에 `pump <ms>`를 보낸다. `pump_off`를 기다린 뒤 최대 60초 동안 안정된 무게(sd ≤ 3g)를 기다려 `{"ok":true,"ms":10000,"before_g":1234.5,"after_g":1258.0,"delta_g":23.5}`를 돌려준다. 로드셀 보정 전이면 `before_g`·`after_g`·`delta_g`를 null로 주고, 웹앱이 컵 무게를 직접 입력받는다. 이 API 말고는 `pump` 명령을 웹에서 보낼 방법이 없어야 한다. 오늘 급수량에는 무게 증가분(없으면 0)을 더한다
- 시험 모드 메시지(`node` 없는 JSON 전부)는 따로 API를 만들지 않고 WebSocket `type:"test"`로 보낸다
- `POST /api/raw` `{"src":"COM5","text":"air a"}` — **시험 모드 전용**. 허용 목록 없이 그 포트로 그대로 보낸다. `config.yaml`의 `allow_raw: true`일 때만 켜진다 (기본 true, 시연 때는 false)

WebSocket 규칙:
- 접속하면 `{"type":"snapshot","state":{...}}`를 1번 보낸다
- 이후 `{"type":"data"|"evt"|"ack"|"diag"|"link"|"log"|"test","node":?,"payload":{...},"server_time":...}`
- 서버는 15초마다 `{"type":"ping"}`을 보낸다. 웹앱은 30초 동안 아무것도 못 받으면 다시 연결한다
- 느린 접속자 때문에 서버가 막히지 않게 접속자마다 보내기 큐를 두고, 500개가 넘게 쌓이면 연결을 끊는다

공통:
- 오류 응답 형식: `{"ok":false,"error":"code","message":"한국어"}` (HTTP 400/404/409/503)
- CORS: 개발용으로 `http://localhost:5173`과 같은 LAN의 `:5173`을 허용
- `web/dist`가 있으면 `/`에 정적 파일로 띄우고, SPA 라우팅을 위해 모르는 경로는 `index.html`로 보낸다 (NFR-03)
- 시작할 때 콘솔에 접속 주소를 크게 출력한다: `웹앱: http://192.168.0.12:8000  (같은 WiFi의 폰에서 열기)`
- 설정의 `pin`이 있으면 급수·보정·정지-제외 명령에 `X-Chamgap-Pin` 헤더를 요구한다 (SAFE-08). **정지는 PIN 없이 항상 허용**한다

### 8. config.example.yaml

```yaml
mode: mock            # mock | serial | mqtt
serial:
  ports: []           # 비우면 자동 탐색. 예: [COM5, COM6, COM7]
  baud: 115200
mqtt:
  host: 127.0.0.1
  port: 1883
mock:
  speed: 1            # 5면 5배 빠르게
  scenarios: {}       # 예: {Z2: soil_a_unplugged}
server:
  host: 0.0.0.0
  port: 8000
  allow_raw: true
  pin: null           # 예: "1234"
safety:
  max_ml_per_shot: 50
  max_ml_per_day: 300
storage:
  keep_days: 30
```

### 9. 마일스톤 (하나씩)

| # | 할 일 | 확인 방법 (내가 직접 함) |
|---|---|---|
| **S1** | 뼈대: 폴더, requirements, config, `python -m chamgap --mode mock` 실행 시 FastAPI 기동, `/api/link`, protocol.py + 시험 | `pytest` 통과, 브라우저 `http://localhost:8000/docs` 열림 |
| **S2** | serial 링크 + hub + 콘솔 출력 + JSONL 기록 | ESP32(노드 펌웨어)를 꽂고 실행 → 콘솔에 Z1 data가 5초마다, `logs/` 파일 생김. 케이블 뽑았다 꽂으면 다시 연결 |
| **S3** | 명령 대기열 + 안전 검사 + 명령 API (`water`, `stop`, `stop-all`, `command`, `preflight`, `flow-cal/run`, `raw`) | Swagger(`/docs`)에서 `tare`, `info` 보내면 ack 응답. 유량 보정 전 water → `flow_uncal` 거부, flow-cal/run은 동작 |
| **S4** | mock 링크 (값 흉내 + 명령 응답 + 시나리오) | `--mode mock`으로 3구역 data가 콘솔에. water 10 → evt, ack, 무게 증가 |
| **S5** | 진단 엔진 + 규칙 24개 + yaml + 억제 | 시나리오마다 pytest로 해당 진단이 켜짐(가짜 시간으로 hold 시간 건너뛰기). README 표와 일치 |
| **S6** | SQLite 저장 + 이력·사건·CSV API | `/api/history?node=Z1&metric=weight_g&minutes=60&bucket=60` 응답, CSV 엑셀에서 한글 정상 |
| **S7** | WebSocket + 상태 형식(5.3) + 1초 타이머 | `websocat ws://localhost:8000/ws` 또는 간단한 html로 snapshot과 data 수신 확인 |
| **S8** | MQTT 링크 | Mosquitto 켜고 `--mode mqtt` → `mosquitto_pub -t chamgap/Z1/data -m '{...}'`가 화면·진단에 반영 |
| **S9** | 마무리: 정적 웹 서빙, LAN 주소 출력, PIN, README(문제 해결 포함), `run_server.bat` | 폰 브라우저로 노트북 주소 접속 (웹앱 빌드 후) |

### 10. 품질 기준

- 모든 규칙에 테스트가 있다. 시간은 주입 가능한 `Clock`으로 다뤄 테스트에서 건너뛸 수 있게 한다.
- 타입 힌트를 전부 달고, `ruff` 기본 규칙으로 경고가 없게 한다.
- 8시간 연속 실행해도 메모리가 계속 늘지 않는다. 링버퍼 크기를 제한하고, 접속이 끊긴 WebSocket을 정리한다.
- 서버 로그는 `logging`으로 남기고, 콘솔에는 사람이 읽기 쉬운 한 줄 요약을 띄운다 (`Z1 #42 23.4°C 45% 흙 0.53 1234g`).
- **하지 말 것**: 통신 규약 변경, 웹앱용 문구를 웹앱에서 만들게 하는 것, 블로킹 I/O를 async 함수에서 직접 호출, 전역 변수로 상태 공유, 진단 기준값 하드코딩.

시작: **S1만** 진행하고 멈춰라.
