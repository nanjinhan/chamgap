# 참값(CHAMGAP) 센서 진단 시스템

구역 3개(Z1·Z2·Z3)의 ESP32 센서 값(온습도, 토양수분, 무게)을 웹앱에서 실시간으로 보고, 웹에서 급수·보정 명령을 보내는 프로젝트입니다.

| 폴더 | 내용 |
|---|---|
| [`docs/`](docs/) | 요구사항지시서(v2.0), 작업 지시, **이어서 만들기 인계서**, 와이어프레임 |
| [`firmware/`](firmware/) | ESP32 펌웨어 (지금: USB 시리얼 버전) |
| [`server/`](server/) | Python 서버: USB·MQTT 연결, 진단 규칙 24개, 가짜 ESP32(mock) |
| [`web/`](web/) | React 웹앱 (Vite · TypeScript · Tailwind) |

- 지금 상태와 다음 할 일: [`docs/04_이어서_만들기.md`](docs/04_이어서_만들기.md)
- ESP32를 USB로 연결해 앱에서 보기: [`firmware/README.md`](firmware/README.md)
- 배포 구조(계획): ESP32 → WiFi → **Supabase**(데이터) ↔ **Vercel**(웹앱)
