# 참값 웹앱 (React)

ESP32가 Supabase에 올린 값을 실시간으로 보여 주고, 명령(정지·급수·보정)을 Supabase `commands` 표에 넣는다.
노트북 서버는 필요 없다.

| 파일 | 하는 일 |
|---|---|
| `src/lib/supabase.ts` | Supabase 접속 (주소·공개 키는 환경변수) |
| `src/lib/live.ts` | 처음 불러오기 + Realtime 구독(readings·events·commands·diagnostics) + 15초마다 놓친 값 확인 |
| `src/lib/nodeState.ts` | Supabase 행 → 화면용 구역 상태 (끊김·보정 전·읽기 실패, 진단 서버 결과) |
| `src/lib/commands.ts` | 명령 넣기·결과 기다리기(기본 10초, tare·cal 15초, flowcal ms+70초), 모두 정지, 거부 이유 문구 |
| `src/store/useAppStore.ts` | 화면이 읽는 상태 (zustand) |

## 처음 한 번
```bat
cd web
npm install
copy .env.example .env.local
```
`.env.local`에 Supabase Project URL과 공개 키(Publishable 또는 anon)를 넣는다. 이 파일은 GitHub에 올라가지 않는다.

## 실행
```bat
cd web
npm run dev
```
- 노트북: http://localhost:5173
- 같은 WiFi의 폰: 화면에 나오는 `Network: http://192.168.x.x:5173`

## 확인
```bat
npm run lint
npx tsc -b
npm run build
```

## 배포 (Vercel)
GitHub 저장소를 Vercel에 연결하고 Root Directory를 `web`으로, 환경변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣는다 (`docs/04_이어서_만들기.md` P7).
