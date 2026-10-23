# 참값 펌웨어 (ESP32)

지금 버전: **`node/` — WiFi · Supabase 버전 (node-2.1)**
ESP32가 WiFi로 센서 값을 Supabase에 5초마다 올리고, 웹에서 넣은 명령(급수·정지·보정)을 받아 실행합니다.
USB 시리얼 출력도 예전과 똑같이 나오므로, 시리얼 모니터나 노트북 서버로도 볼 수 있습니다.

| 파일 | 내용 | 고치는 사람 |
|---|---|---|
| `node.ino` | 센서·펌프·명령 (본 루프) | — |
| `cloud.h` | WiFi·Supabase 연결 (코어 0의 별도 작업. 네트워크가 느려도 펌프는 제시간에 꺼짐) | — |
| `config.h` | 구역 이름, 어떤 센서를 꽂았는지, 핀 번호, 안전 한도 | 보드마다 |
| `secrets.h` | WiFi 이름·비밀번호, Supabase 주소·공개 키, 기기 키 (**GitHub에 안 올라감**) | 사용자 |
| `secrets.example.h` | `secrets.h`의 틀 | — |

지금 지원하는 센서 (`config.h`에서 켜고 끔)
| 센서 | 설정 | 기본 핀 |
|---|---|---|
| 온습도 A·B — **SHT31 두 개** (지금 설정) | `USE_SHT31_A 1`, `USE_SHT31_B 1` | 둘 다 SDA 21, SCL 22. **A는 ADR→GND(0x44), B는 ADR→VIN(0x45)** |
| 온습도 A — DHT11 (예전 임시) | `USE_DHT11_A` (지금 0) | `DHT_PIN 4` |
| 토양수분 A·B (SEN0193) | `USE_SOIL_A`, `USE_SOIL_B` | 32, 33 |
| 로드셀 + HX711 | `USE_HX711` | DT 26, SCK 27 |
| 펌프 (DFR0457) | `USE_PUMP` | 25 |
| 12V 감지 / 누수 | `USE_V12_SENSE`, `USE_LEAK` | 34 / 35 (지금은 0) |

WiFi 없이 USB로만 쓰려면 `config.h`에서 `USE_CLOUD 0`.

## 1. 처음 한 번: Supabase 함수 추가
`supabase/schema.sql`이 바뀌었습니다 (ESP32가 명령을 가져가고 결과를 적는 함수 2개 추가).
Supabase → 왼쪽 **SQL Editor** → **New query** → `supabase/schema.sql` 전체를 붙여넣고 **Run**.
여러 번 실행해도 안전합니다. 이미 있는 값·기기 키는 그대로입니다.

## 2. 처음 한 번: 라이브러리 설치
Arduino IDE → 왼쪽 책 아이콘(라이브러리 매니저) → 검색 → **만든 사람을 확인하고** 설치
| 검색어 | 고를 것 (이름 · 만든 사람) |
|---|---|
| `HX711` | **HX711 Arduino Library** · Bogdan Necula (이름이 그냥 "HX711"인 Rob Tillaart 것이 **아님**) |
| `WebSockets` | **WebSockets** · Markus Sattler |
| `SHT31` | **Adafruit SHT31 Library** · Adafruit (같이 설치하겠냐고 물으면 **Install All**) |
| `ArduinoJson` | **ArduinoJson** · Benoit Blanchon (7.x) |
| `DHT sensor library` | (DHT11을 쓸 때만) **DHT sensor library** · Adafruit |

보드: 도구 → 보드 → esp32 → **ESP32 Dev Module** (esp32 보드 패키지 3.x)

## 3. 올리기
1. Arduino IDE에서 `firmware/node/node.ino`를 연다 (`cloud.h`·`config.h`·`secrets.h`가 옆 탭에 같이 열린다).
2. `secrets.h`에 WiFi 이름·비밀번호, `DEVICE_KEY`가 들어 있는지 본다. (`SUPABASE_URL`, `SUPABASE_KEY`는 채워져 있다)
3. `config.h`의 센서 켜고 끄기(`USE_...`)와 핀이 실제 배선과 같은지 본다.
4. 도구 → 포트에서 ESP32 포트(COM 번호)를 고르고 **업로드(→ 버튼)**.
5. 시리얼 모니터를 **115200**으로 열면 이런 순서로 나온다.
   ```
   # 참값 노드 시작 node-2.1 · 구역 Z1
   # 온습도 A (SHT31, 0x44) 찾음
   # 온습도 B (SHT31, 0x45) 찾음
   # WiFi 연결 중: (와이파이 이름)
   # WiFi 연결됨 · IP 192.168.0.23 · 세기 -55dBm
   # Supabase 실시간 명령 연결됨
   # 시각 맞춤(NTP) 완료 · 오늘 20261023 · 오늘 급수 0.0mL
   {"t":"data","node":"Z1","ms":20111,"seq":4,...,"rssi":-55}
   ```

## 4. 잘 올라가는지 보기
- Supabase → 왼쪽 **Table Editor** → `readings` → 5초마다 `Z1` 줄이 늘어난다 (오른쪽 위 새로고침).
- 명령 시험: Table Editor → `commands` → **Insert row** → `node` `Z1`, `cmd` `info` → Save
  → 몇 초 안에 그 줄의 `status`가 `done`이 되고 `result`에 ack가 들어간다. (넣고 10초 안에 못 가져가면 `expired`)

## 5. 보정 (보정 화면은 웹에 곧 생긴다)
보정값은 ESP32 안(NVS)에 저장돼 전원을 꺼도 남는다. 시리얼 모니터 입력칸(줄 끝: "새 줄") 또는 위의 `commands` 표로 보낸다.
| 하고 싶은 것 | 명령 | 순서 |
|---|---|---|
| 로드셀 영점 | `tare` | 판을 비우고 (약 2초) |
| 로드셀 배율 | `cal 500` | tare 다음, 500g짜리를 올리고 |
| 토양 A 공기 값 | `soilcal a air` | 센서를 공중에 들고 |
| 토양 A 물 값 | `soilcal a wet` | 경계선까지 물컵에 꽂고 |
| 토양 B | `soilcal b air` / `soilcal b wet` | 위와 같이 |
| 펌프 유량 재기 | `flowcal 10000` | 로드셀 보정 뒤, 화분(또는 컵)을 올리고. 10초 펌프 → 늘어난 g이 ack에 나온다 (`delta_g`) |
| 펌프 유량 저장 | `flow 10000 23.5` | 위에서 나온 `delta_g`를 넣는다. 이게 있어야 `water <mL>`가 된다 |
| 지금 설정 보기 | `info` | |
| 측정 주기 바꾸기 | `interval 10000` | 2000~600000 ms |
| 구역 이름 바꾸기 | `id z2` 다음 `reboot` | 보드마다 다르게 |
`pump <ms>`(시험용 펌프)와 `help`는 시리얼에서만 받는다.

## 문제 해결 (시리얼 모니터의 `#` 줄을 본다)
| 나오는 말 | 확인할 것 |
|---|---|
| `와이파이 이름을 못 찾았어요` | `WIFI_SSID` 철자, 공유기가 **2.4GHz**인지 (ESP32는 5GHz 안 됨) |
| `비밀번호가 틀린 것 같아요` | `WIFI_PASSWORD` |
| `Supabase 실패: ... SUPABASE_KEY(공개 키) 확인` | `secrets.h`의 `SUPABASE_KEY` |
| `Supabase 실패: ... DEVICE_KEY(기기 키) 확인` | `secrets.h`의 `DEVICE_KEY` (Supabase SQL Editor에서 `select value from private.secrets where name = 'device_key';`) |
| `Supabase 실패: ... schema.sql 을 ... 다시 실행하세요` | 위 1번을 안 했음 |
| `Supabase 실시간 연결 끊김` | 괜찮다. 2초마다 명령을 확인하며 스스로 다시 연결한다 |
| 컴파일 오류 `secrets.h 가 없습니다` | `secrets.example.h`를 복사해 `secrets.h`로 저장하고 채운다 |
| 컴파일 오류 `HX711.h` / `WebSocketsClient.h` / `ArduinoJson.h` 없음 | 2번 라이브러리 설치 (HX711은 Bogdan Necula 것) |
| `온습도 A/B (SHT31) 못 찾음` | SDA 21·SCL 22·3.3V·GND 선. 둘 다 연결했다면 **B의 ADR 핀을 VIN(3.3V)에** (안 하면 둘 다 0x44라 B를 못 찾는다) |
| 컴파일 오류 `Adafruit_SHT31.h` 없음 | 2번에서 Adafruit SHT31 Library 설치 |
| 토양 값이 `null` | 그 센서의 mV가 150 미만(신호선 빠짐) 또는 3050 초과(GND 빠짐·단락) |
| 무게 raw가 안 바뀜 | HX711 DT·SCK 선, 로드셀 4선 |

## USB로 노트북 서버에 붙이기 (예전 방식, 지금도 됨)
```bat
cd server
run_server.bat --mode serial
```
시리얼 모니터는 닫는다 (열려 있으면 서버가 포트를 못 연다). 펌웨어를 다시 올릴 때는 서버를 먼저 끈다 (Ctrl+C).

## 확인한 것 / 못 한 것
- 이 노트북의 arduino-cli(ESP32 core 3.3.11, WebSockets 2.7.2, ArduinoJson 7.4.3, HX711 Arduino Library 0.7.5, Adafruit SHT31 2.2.2, DHT 1.4.7)로 **컴파일 통과** (지금 설정 SHT31 A·B: 보드 저장공간 90%). `USE_CLOUD 0`, DHT11, SHT31 + 12V + 누수 켠 설정도 컴파일 통과.
- Supabase 쪽: 기기 키로 `readings`·`nodes` 쓰기 권한과 열 이름 일치, Realtime 알림(명령 넣고 0.1~0.5초)을 노트북에서 확인 (`node supabase/check.mjs`).
- **실제 보드에 올려 WiFi로 붙여 본 것은 아니다** (하드웨어가 이 노트북에 없음).
