# Supabase 준비 (P1)

참값의 데이터(센서 값·사건·명령)를 보관하고 실시간으로 전달하는 곳. 무료(Free) 플랜.

## 1. 프로젝트 만들기 (처음 한 번)
1. https://supabase.com → 로그인 → **New organization**: Name `chamgap`, Type `Personal`, Plan `Free` → **Create organization**
2. **New project**
   | 칸 | 넣을 것 |
   |---|---|
   | Project name | `chamgap` |
   | Database Password | **Generate a password** → 메모장에 저장 (평소에는 안 씀) |
   | Region | **Need a specific region?** → **Northeast Asia (Seoul)** (안 되면 Tokyo) |
   | Security 체크 3개 | 기본값 그대로 |
3. **Create new project** → 1~2분 기다린다.

## 2. 표 만들기
1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 폴더의 `schema.sql` 내용을 **전부** 복사해 붙여넣는다.
3. **Run** (또는 Ctrl+Enter). "destructive operation" 확인 창이 뜨면 **Run this query** — 다시 실행해도 안전하게 만들려고 넣은 `drop ... if exists` 때문이다.
4. 아래 결과 칸에 `device_key`, `diag_key`가 나온다. **메모장에 저장한다. 채팅·GitHub에는 올리지 않는다.**
   - `device_key`: ESP32가 값을 올릴 때 쓰는 비밀값 → 나중에 `firmware/node/secrets.h`에 넣는다
   - `diag_key`: 진단 서버(선택)용

다시 보고 싶으면 SQL Editor에서: `select * from private.secrets;`

## 3. 주소와 공개 키 알려 주기
왼쪽 아래 톱니바퀴 **Project Settings**에서:
- **Data API** (또는 API) → **Project URL**: `https://xxxxxxxx.supabase.co`
- **API Keys** → **Publishable key** (`sb_publishable_...`). 없으면 **Legacy API keys** 탭의 `anon` `public` 키

이 두 개는 **공개해도 되는 값**이라(웹앱에도 들어감) 채팅으로 알려 주면 된다.
`secret` / `service_role` 키는 **절대** 알려 주거나 코드에 넣지 않는다.

## 4. 권한 확인
공개 키를 `web/.env.local`(`web/.env.example`을 복사)에 넣은 뒤, 프로젝트 폴더에서:
```
node supabase/check.mjs
```
웹과 같은 공개 키로 읽기 O / 기기 키 없는 측정값 쓰기 거부 / `pump`·`help` 명령 거부 / `water 10` 허용 / 속인 상태·시각 무시 / 10초 넘은 명령 `expired`(매분 검사라 최대 약 70초)를 확인한다. 마지막 줄이 "모두 통과했습니다."면 된다.
실행할 때마다 node `TEST` 명령이 1줄 남는다 (실제 ESP32는 가져가지 않고 7일 뒤 지워진다).

## 만들어지는 것
| 이름 | 내용 |
|---|---|
| `readings` | 센서 측정값 (ESP32 → 웹). 14일 지나면 자동 삭제 |
| `events` | 부팅·펌프·보정 사건, 메모 (30일 보관) |
| `nodes` | 구역별 마지막 상태·보정값 |
| `commands` | 웹 → ESP32 명령 (`water 10`, `stop`, `tare` …). 10초 안에 안 가져가면 `expired`, 7일 보관 |
| `diagnostics`, `service_status` | 진단 서버(선택)용 |
| `latest_readings` | 구역별 마지막 측정값 (웹 첫 화면용) |
| `history()` | 그래프용 평균 (1분·5분·15분) |
| `claim_command()`, `finish_command()` | ESP32가 명령을 하나 가져가고(10초 넘은 것은 expired, stop 먼저) 결과를 적는 함수. 기기 키 필요 (P2에서 추가) |

`schema.sql`이 바뀌면 SQL Editor에서 **전체를 다시 실행**한다. 이미 있는 값과 기기 키는 그대로 남는다.

권한: 누구나 읽기. 웹은 명령 넣기·메모만. 측정값·상태 쓰기는 `x-device-key`가 맞는 ESP32만. 웹이 보낼 수 있는 명령은 허용 목록만(`pump`·`help` 불가). 삭제는 아무도 못 하고 자동 정리만 지운다.
