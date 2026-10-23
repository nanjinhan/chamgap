# VS Code 프롬프트 ② — 참값 센서 진단 웹앱 (React)

> **사람이 읽는 부분 — 쓰는 법**
> 1. 브리지 서버(프롬프트 ①)의 **S4(mock 모드)까지** 끝난 뒤 시작합니다. 웹앱은 서버의 mock 모드를 켜 놓고 개발합니다:
>    `cd server` → `python -m chamgap --mode mock --mock-speed 5`
> 2. VS Code에서 `chamgap` 폴더를 열고, AI 채팅(Agent 모드)에 아래 **"AI에게"부터 끝까지** 붙여넣습니다.
> 3. **"마일스톤 W1만 해줘"**처럼 하나씩 시킵니다. 각 마일스톤의 **확인 방법**을 직접 해보고 넘어갑니다.
> 4. 디자인 시안 이미지를 `docs/design/reference.png`로, 와이어프레임 링크(또는 캡처)를 `docs/design/wireframe/`에 넣어 두면 AI가 참고합니다.

---

## AI에게

너는 이 프로젝트의 프론트엔드 개발자다. 브리지 서버(`server/`)가 주는 실시간 센서 상태와 진단을 보여주고, 급수·보정을 안전하게 요청하는 **모바일 우선 웹앱**을 `web/` 폴더에 만든다. 핵심 질문은 **"이 센서 값을 지금 믿어도 되나? 아니면 무엇을 확인해야 하나?"**이고, 화면은 이 질문에 바로 답해야 한다.

### 0. 반드시 지킬 것

1. **먼저 읽어라**: `docs/01_요구사항지시서.md` 전체(특히 5장 API, 6장 진단, 7장 안전, 8장 UI), 그리고 `docs/design/`의 시안과 와이어프레임.
2. **진단·판단 로직을 웹앱에서 만들지 마라.** 진단 목록, 단계(status), 한국어 문구, 급수 가능 여부는 전부 서버가 준다. 웹앱은 보여주고 요청만 한다. 단, 값이 "몇 초 전" 것인지 계산하는 것은 웹앱이 한다.
3. **안전 UI는 꾸밈보다 우선**한다 (지시서 7장):
   - **모두 정지** 버튼은 모든 화면에서 항상 보이고 한 번에 눌린다. 확인 창이 없다.
   - 급수는 **1초 길게 누르기**로만 실행된다.
   - 서버의 사전 점검(preflight)이 실패하면 급수 버튼이 비활성이고, 이유가 보인다.
4. 한 번에 **마일스톤 하나만** 한다. 끝나면 만든 것과 확인 방법을 짧게 말하고 멈춘다.
5. React Bits·cult-ui 컴포넌트 설치가 실패하거나 이름이 다르면, **추측으로 비슷한 이름을 계속 시도하지 마라.** 해당 컴포넌트 페이지의 설치 명령을 확인하라고 나에게 말하고, 그동안은 아래 표의 **대체 구현**으로 진행한다.
6. 모든 문구는 한국어. 센서는 역할과 함께 쓴다: "온습도 A (대상)", "토양 B (비교)".
7. TypeScript `strict`. `any` 금지(불가피하면 이유 주석).

### 1. 기술 스택

| 용도 | 선택 |
|---|---|
| 빌드 | Vite + React 18 이상 + TypeScript |
| 스타일 | Tailwind CSS v4 (`@tailwindcss/vite`) |
| 컴포넌트 기반 | shadcn/ui (`npx shadcn@latest init`), 경로 별칭 `@/` |
| 움직임 | `motion` (cult-ui가 요구하는 패키지를 따른다. `framer-motion`을 요구하면 그것) |
| 화려한 UI | **React Bits** (`@react-bits/<이름>-TS-TW`), **cult-ui Dynamic Island** (`@cult-ui/dynamic-island`) |
| 라우팅 | react-router-dom |
| 상태 | zustand |
| 그래프 | recharts |
| 아이콘 | lucide-react (이모지 금지) |
| 글꼴 | Pretendard (한글, npm `pretendard`) + Plus Jakarta Sans (숫자·영문, `@fontsource-variable/plus-jakarta-sans`) |

**설치 순서 (W1에서 그대로 실행)**
```bash
npm create vite@latest web -- --template react-ts
cd web
npm i
npm i -D tailwindcss @tailwindcss/vite
# vite.config.ts 에 tailwindcss() 플러그인, tsconfig 의 paths "@/*": ["./src/*"], vite alias '@' 설정
npx shadcn@latest init
npx shadcn@latest add @cult-ui/dynamic-island
npx shadcn@latest add @react-bits/CountUp-TS-TW
# … 아래 3절 표의 나머지
npm i react-router-dom zustand recharts lucide-react pretendard @fontsource-variable/plus-jakarta-sans
```
- `@react-bits`, `@cult-ui` 이름공간이 인식되지 않으면, `components.json`의 `registries`에 등록이 필요한지 shadcn 문서를 확인하고 나에게 알린다.
- 설치된 컴포넌트는 `src/components/ui/`(cult-ui, shadcn)와 `src/components/react-bits/`에 둔다. **설치된 원본 파일은 고치지 말고** 감싸는 래퍼를 `src/components/fx/`에 만든다. 원본을 꼭 고쳐야 하면 맨 위에 `// MODIFIED:` 주석으로 이유를 남긴다.

**vite.config.ts 개발 서버**
```ts
server: {
  host: true,              // 같은 WiFi 폰에서 http://<노트북IP>:5173 접속
  proxy: {
    '/api': 'http://localhost:8000',
    '/ws':  { target: 'ws://localhost:8000', ws: true },
  },
}
```
웹앱 코드는 서버 주소를 하드코딩하지 않고 **항상 상대 경로**(`/api/...`, `/ws`)를 쓴다. 그래야 빌드 후 서버가 같이 띄울 때도 그대로 동작한다.

### 2. 디자인 시스템 (팀 시안 기준)

시안의 느낌은 **연하늘 그라데이션 위의 흰 둥근 카드, 파란 포인트, 넉넉한 여백, 부드러운 그림자**다. `src/styles/tokens.css`에 CSS 변수로 정의하고, Tailwind v4 `@theme`으로 연결한다.

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--bg` | `linear-gradient(165deg,#EEF5FF 0%,#C9DEFE 55%,#9FC2FF 100%)` | 앱 배경 (위에 Soft Aurora를 아주 흐리게) |
| `--surface` | `#FFFFFF` | 카드 |
| `--surface-2` | `#F4F8FF` | 카드 안 작은 칸 |
| `--primary` | `#2F6BFF` | 선택 탭, 주 버튼, 게이지 |
| `--primary-soft` | `#E8EFFF` | 아이콘 원, 보조 배경 |
| `--ink` | `#18213A` | 본문 글자 |
| `--ink-2` | `#4F5B76` | 보조 글자 (흰 배경에서 대비 4.5:1 이상) |
| `--line` | `#EEF1F7` | 구분선 |
| `--island` | `#0B0F1A` | Dynamic Island 배경 |
| `--ok` / `--ok-soft` | `#16834A` / `#E3F5EA` | 정상 |
| `--info` / `--info-soft` | `#2456D6` / `#E8EFFF` | 정보 (보정 전 등) |
| `--warn` / `--warn-soft` / `--warn-dot` | `#B45309` / `#FFF1E0` / `#E8890C` | 주의 |
| `--fault` / `--fault-soft` / `--fault-dot` | `#B4233A` / `#FDE8EB` / `#D6334A` | 고장 |
| `--offline` / `--offline-soft` | `#6B7280` / `#EEF0F3` | 끊김 |
| `--radius-card` | `22px` (노트북 24px) | 카드 |
| `--radius-btn` | `16px` | 큰 버튼 |
| `--shadow-card` | `0 10px 28px rgba(40,90,180,.12)` | 카드 |

- 글자: 큰 숫자 44px/800, 화면 제목 17px/800, 카드 제목 13~15px/700~800, 본문 13~14px, 캡션 11~12px. 숫자는 `font-variant-numeric: tabular-nums`.
- 상태는 **색 + 글자 + 아이콘**으로 함께 표시한다 (UI-05). 예: 주황 점 + "주의".
- 터치 영역은 최소 44×44px.
- 이번 버전은 **밝은 테마만** 만든다.
- 화면 폭: 모바일 390px 기준 설계 → 768px 이상 2단 → 1024px 이상 노트북 대시보드(와이어프레임 10번).

### 3. React Bits · cult-ui 사용 지도

**원칙**: 화려함은 **배경·전환·강조**에 쓰고, **숫자와 경고 글자 자체는 항상 또렷하게** 둔다. 화면 하나에 WebGL 배경은 최대 1개. `prefers-reduced-motion` 또는 설정의 "움직임 줄이기"가 켜지면, 배경을 정지 그라데이션으로 바꾸고 텍스트 애니메이션을 끈다 (UI-09). 탭이 안 보이면(`document.hidden`) WebGL을 멈춘다.

| 컴포넌트 (설치 이름) | 어디에 | 설정·주의 | 설치 실패 시 대체 |
|---|---|---|---|
| **Dynamic Island** `@cult-ui/dynamic-island` | 모든 화면 맨 위 가운데 | 4절 규칙대로 크기 전환 | 없음 (필수, 직접 고쳐서라도 사용) |
| **Soft Aurora** `SoftAurora` | 앱 배경 | 파랑 계열 `#2F6BFF`·`#9FC2FF`, 불투명도 0.25~0.35 | `Aurora` → 그것도 없으면 CSS 그라데이션 |
| **Blur Text** `BlurText` | 홈 인사말 "안녕하세요, 참값팀" | 처음 1번만 | motion fade |
| **Rotating Text** `RotatingText` | 홈 부제 "지금 확인 중: 온도 · 습도 · 토양 · 무게" | 3초 간격 | 고정 문구 |
| **Count Up** `CountUp` | 원형 게이지 숫자, 통계 숫자 | 값이 바뀔 때만 0.4초. 처음 표시 때 0부터 세지 말 것 | 그냥 숫자 |
| **Decrypted Text** `DecryptedText` | 새 진단 제목 등장 | 1회, 0.6초 이내. 읽기 방해 금지 | motion fade |
| **Shiny Text** `ShinyText` | "실시간" 표시, 섬의 "급수 중" | 은은하게 | 일반 글자 |
| **Gradient Text** `GradientText` | 노트북 화면 제목 "참값 센서 진단" | 파랑 계열만 | 일반 글자 |
| **Pill Nav** `PillNav` | 구역 탭 Z1·Z2·Z3 | 탭 옆에 상태 점 | shadcn Tabs + 알약 모양 |
| **Tilted Card** `TiltedCard` | 홈의 구역 카드 (캐러셀) | **마우스에서만** 기울임, 터치에서는 끔 | 일반 카드 |
| **Spotlight Card** `SpotlightCard` | 센서 카드 | spotlight 색 `rgba(47,107,255,.12)` | 일반 카드 |
| **Border Glow** `BorderGlow` | A·B 비교 카드가 주의일 때 | 주황 | outline 2px |
| **Electric Border** `ElectricBorder` | **고장(fault) 카드만** | 화면당 1개까지, 빨강 | outline 2px + 깜빡임 없음 |
| **Animated List** `AnimatedList` | 진단 목록, 사건 기록, 급수 사전 점검 | 새 항목이 위에서 들어옴 | motion layout |
| **Animated Content** `AnimatedContent` / **Fade Content** `FadeContent` | 화면 섹션 등장 | 20px 이내 이동, 0.3초 | motion |
| **Elastic Slider** `ElasticSlider` | 급수량 (0~50mL, 5 단위) | 키보드로도 조절 가능해야 함 | `<input type=range>` 스타일 |
| **Stepper** `Stepper` | 보정 마법사, 시험 모드 단계 | 단계 이동은 서버 ack가 와야 가능 | 직접 만든 단계 표시 |
| **Counter** `Counter` | 오늘 급수량 "30 / 300 mL" | | 숫자 |
| **Dock** `Dock` | **노트북(≥1024px)** 하단 메뉴 | 확대 효과는 마우스에서만 | 하단 탭 바 |
| **Click Spark** `ClickSpark` | 앱 전체를 감싸 버튼 클릭 반짝임 | 파랑, 작게. 정지 버튼에는 빨강 | 없음 |
| **Magnet** `Magnet` | 노트북의 급수 버튼 | 약하게 (padding 40, strength 3 정도) | 없음 |
| **Glare Hover** `GlareHover` | 노트북 구역 카드 | | 없음 |
| **Gradual Blur** `GradualBlur` | 스크롤 목록 아래쪽 (하단 바와 겹치는 곳) | | CSS mask |
| **Glass Surface** `GlassSurface` | 하단 탭 바, 상단 고정 헤더 | 흐림 배경 | `backdrop-blur` |

**Micro 카테고리** (있으면 사용, 없거나 유료면 대체 구현):
| 이름 | 어디에 | 대체 |
|---|---|---|
| `HoldButton` | **급수 실행 버튼 (1초)** | **직접 구현 필수**: 누르는 동안 채워지는 막대, 1초 전에 떼면 취소, 키보드 Space 길게도 동작 |
| `SloshGauge` | 급수 화면의 물 원 | motion으로 물결 높이 |
| `StatusMark` | 상태 점·체크 | 점 + 글자 |
| `SpringCheck` | 진단의 "확인 방법" 체크리스트 | checkbox |
| `RubberSegment` | 진단 필터 (전체·고장·주의·정보) | 알약 세그먼트 |
| `GlideSelect` | 기록 기간 (1시간·6시간·24시간) | 알약 세그먼트 |
| `PromptBar` | 시험 모드 명령 입력 | input + 버튼 |
| `SwipeToast` | 명령 결과 알림 | shadcn `sonner` |
| `PulseHeart` | 데이터를 받을 때마다 한 번 뛰는 "살아 있음" 표시 | 점 scale 펄스 |
| `SquishSwitch` | 설정 스위치 | shadcn Switch |
| `LatticeLoader` | 서버 연결 중 | 스피너 |

작업 시작 전에 위 표에서 **설치에 성공한 것 / 대체한 것** 목록을 `web/COMPONENTS.md`에 표로 남긴다.

### 4. Dynamic Island 규칙 (`src/features/island/`)

cult-ui의 `DynamicIslandProvider`를 앱 최상단에 두고, `useIslandController()` 훅이 아래 **우선순위**로 크기와 내용을 정한다. 같은 상태가 계속되면 다시 애니메이션하지 않는다.

| 우선순위 | 조건 | 크기 프리셋 | 내용 |
|---|---|---|---|
| 1 | WebSocket 끊김 | `minimalLeading` (+ 탭하면 `compactLong`) | 빨간 점 "서버 끊김 · 다시 연결 중" |
| 2 | 어느 구역이든 펌프 켜짐 | `large` | "Z1 급수 중 · 10mL", 진행 막대(경과/dur), 남은 초, 무게 변화(+g), **정지 버튼** |
| 3 | 새 fault 진단 (since 6초 이내, 아직 안 본 것) | `tall` → 6초 뒤 `compactLong` | 단계 배지, 구역·센서, 제목, 한 줄 설명, [자세히] [닫기] |
| 4 | 활성 warn/fault 1개 이상 | `compactLong` | 가장 나쁜 진단 1개 "Z1 온습도 B 주의" + 오른쪽 핵심 숫자 |
| 5 | 그 외 | `compact` | 초록 점 "3구역 연결" (+ `PulseHeart`) |

- 섬을 탭하면: 4·5번 상태에서는 `medium`으로 펼쳐 구역별 요약(점 3개 + 진단 수)을 보여주고, 다시 탭하면 접는다.
- 크기 전환은 `scheduleAnimation`으로 자연스럽게 잇는다 (예: `compact → large` 사이에 `compactLong` 150ms).
- 섬 내용 변화는 `aria-live`로 읽어 준다: fault는 `assertive`, 나머지는 `polite`.
- 시험 모드 화면에서는 "시험 모드 · COM5"를 `compact`로 보여준다.

### 5. 데이터 계층

**타입** `src/types/api.ts`: 지시서 4.2절(data, evt, ack, info)과 5.3절(state), 6.2절(diagnostic)을 그대로 옮긴다. 서버가 모르는 키를 더 보낼 수 있으니 `[key: string]: unknown`을 허용한다.

**WebSocket** `src/lib/ws.ts`
- `/ws`에 접속하고, 끊기면 1s → 2s → 4s … 최대 10s 간격으로 다시 접속한다.
- 30초 동안 아무것도 못 받으면(ping 포함) 끊고 다시 접속한다.
- 접속하면 `snapshot`으로 store를 통째로 교체하고, 이후 메시지는 부분 갱신한다.

**store** `src/store/useAppStore.ts` (zustand)
```ts
{
  conn: 'connecting' | 'open' | 'closed',
  link: LinkStatus | null,            // /api/link
  nodes: Record<NodeId, NodeState>,   // 서버 state 그대로
  recent: Record<NodeId, DataMsg[]>,  // 그래프용 최근 120개
  events: EventItem[],                // 최근 200개
  testLog: TestLine[],                // 시험 모드, 최근 300줄
  pumpProgress: Record<NodeId, { start: number; dur: number; ml?: number } | null>,
  seenFaults: Set<string>,            // 섬 tall 알림을 본 진단 (code+node+since)
}
```
- `now`는 별도 훅 `useNow(1000)`으로 1초마다 갱신하고, 그걸로 "n초 전"을 계산한다. 30초가 넘은 값은 흐리게, 오프라인이면 회색 + "마지막 값".

**REST** `src/lib/api.ts`: fetch 래퍼. 오류 응답 `{"ok":false,"error","message"}`의 `message`를 그대로 토스트로 보여준다. PIN이 설정돼 있으면 `X-Chamgap-Pin` 헤더를 붙인다 (sessionStorage 보관).

**포맷** `src/lib/format.ts`: 온도 소수 1자리 °C, 습도 정수 %, 토양 소수 2자리(아래 작게 "수분 지수 0~1"), 무게 천 단위 쉼표 + 소수 1자리 g, 시간은 `Intl.RelativeTimeFormat('ko')`. null은 "--".

### 6. 화면 (와이어프레임 01~10과 1:1)

공통 레이아웃 `AppShell`: 배경(Soft Aurora) → 맨 위 Dynamic Island → 화면 내용 → 하단 **탭 바**(모바일, Glass Surface) 또는 **Dock**(노트북) → 오른쪽 아래 **모두 정지** 버튼(빨강, 원형 60px, 항상 보임). 정지를 누르면 `POST /api/stop-all` 후 결과를 토스트로 알린다.

하단 메뉴: 홈 · 진단(활성 수 배지) · 급수 · 기록 · 시험.

| 경로 | 화면 | 내용 (와이어프레임 참고) |
|---|---|---|
| `/` | **01 홈** | 인사말(Blur Text) + "센서 20개 중 19개 정상 · 2초 전 갱신" + 알림 버튼(진단 수). 구역 카드 캐러셀(Tilted Card): 위쪽은 구역 사진 자리(`/public/zones/Z1.jpg`가 있으면 사진, 없으면 연한 그라데이션), 아래 파란 반투명 패널에 구역 이름, 상태 배지, 온도·습도·토양·무게 4칸. 카드 아래 점 표시. "Z1 센서" 제목 + [진단 보기]. 2열 센서 카드(Spotlight Card): 온습도 A, 온습도 B, 토양 A·B, 무게. 마지막 넓은 카드는 펌프(12V 상태, 마지막 급수, 오늘 n/300mL, [급수]). 캐러셀을 넘기면 아래 센서 목록이 그 구역으로 바뀐다 |
| `/zone/:node` | **02 구역 상세** | 뒤로 · "구역 상세" · 급수 원형 버튼. 구역 탭(Pill Nav). **원형 게이지**: 직접 SVG, 270°, 바깥 눈금, 파란 진행 호 + 손잡이 = A 값, 주황 눈금 = B 위치. 가운데 Count Up 숫자 + "온도 · A 대상" + B 칩 "B 26.1° (+2.7)". 범위: 온도 10~40, 습도 0~100, 토양 0~1, 무게 0~3000. "보기 선택" 카드: 원형 아이콘 버튼 4개(온도·습도·토양·무게), 선택하면 게이지가 그 지표로 전환. "A·B 비교" 카드: 막대 2개 + 차이 + 서버 기준(진단 detail에서). 무게일 때는 A·B 대신 "흔들림 ±0.4g". "최근 1시간" 미니 그래프 (A 실선 파랑, B 점선 주황) |
| `/zone/:node/sensor/:sensor` | **03 센서 상세 + 진단** | 센서 이름 + 역할 + 주소/핀. 활성 진단 카드: 단계 배지, n분째, 코드, 제목(Decrypted Text), detail, 그래프(A·B + 허용 범위 띠). "왜 의심되나요"(causes 번호 목록), "이렇게 확인하세요"(checks 체크리스트, 체크하면 `POST /api/mark`로 "확인: …" 기록). [메모 남기기] [기록에서 보기]. 진단이 없으면 초록 "정상 · 믿어도 됩니다" 카드 + 지금 값 + 응답률 |
| `/water` `/water/:node` | **04 급수** | 구역 탭. 물 원(Slosh Gauge) 가운데 "10 mL" + "약 4.3초 · 2.35 mL/s". 급수량 Elastic Slider(0~50, 5 단위, 값 말풍선). "켜기 전 점검" 목록: `GET /api/nodes/{node}/water/preflight?ml=` 결과를 Animated List로, 실패 항목은 빨강 + 이유. **Hold Button** "길게 눌러 급수 (1초)" → `POST /api/nodes/{node}/water`. 급수 중에는 이 버튼이 **정지**로 바뀐다. 아래 "지난 급수: 10mL 예상 → +9.6g 도착 · 정상"(서버 `water_result` 사건). 맨 아래 작게 "하드웨어 비상정지 스위치가 이 화면보다 항상 우선입니다" (SAFE-07). 유량 보정 전이면 Hold Button 대신 [유량 보정하기] |
| `/diagnostics` | **05 진단 목록** | "지금 믿기 어려운 값 n개 · 3구역 중 m구역". 필터(전체·고장·주의·정보, 개수 포함). Animated List로 진단 카드: 단계 배지, 구역·센서·n분째, 제목, detail + 확인 요점 한 줄. fault 카드만 Electric Border. `action`이 있으면 버튼(보정하기 등). 맨 아래 [해결된 진단 n개 보기](`/api/events`의 diag_off) |
| `/calibrate/:node/:kind` | **06 보정 마법사** | kind = `scale` · `soil` · `flow`. 위 탭으로 전환. Stepper + 단계 카드 + 지금 읽는 값 + "안정됨" 표시(최근 5개 표준편차 기준) + [이전] [실행]. 명령은 `POST /api/nodes/{node}/command`, **ack가 ok여야 다음 단계**. ack 실패면 msg를 보여주고 그 단계에 남는다. 7절 참고 |
| `/history/:node` | **07 기록** | 구역 탭, 기간(1·6·24시간 → bucket 60·300·900초), 지표 칩. Recharts 선 그래프: A 실선 파랑, B 점선 주황, 급수 시점 세로 점선 + "급수" 라벨, 진단 구간 연한 주황 띠. "6시간 동안 −18.4g 증발" 같은 한 줄 요약(첫·끝 값 차이). 사건 목록(급수·메모·진단 시작/해제·재시작) + [+ 메모]. 오른쪽 위 CSV 내보내기 |
| `/test` | **08 시험 모드** | 펌웨어 시험 스케치(00~05)용. WebSocket `type:"test"`·`"log"` 메시지를 쓴다. 상단 Stepper 00 I2C · 01 온습도 · 02 토양 · 03 무게 · 04 12V · 05 펌프. **지금 들어오는 `t`로 현재 단계를 자동 표시**(i2c→00, sht→01, soil·soilcal→02, lc·lccal→03, pwr→04, pump·pumpcal·node 없는 evt→05). 최근 메시지의 키=값을 칸으로(숫자 크게, 키는 고정폭 글꼴). 단계별 "확인할 것"(펌웨어 주석과 같은 내용) 중 자동 판단 가능한 것은 체크 표시: 00 `sht_a=1 && sht_b=1`, 01 `abs(d_temp)<0.5 && abs(d_rh)<3`, 02 `a_flag=ok && b_flag=ok`, 03 `hx_ok=1 && sd<2`, 04 `v12_ok=1`. 원시 로그 콘솔(어두운 칸, `#` 줄은 회색, 보낸 명령은 파랑 `→`). 빠른 명령 칩(단계마다 다름: 02 `air a`·`wet a`·`air b`·`wet b`·`show`, 03 `tare`·`cal 500`·`show`, 05 `on 2000`·`off`·`show`) + 명령 입력(Prompt Bar) → `POST /api/raw`. 포트가 여러 개면 포트 선택 |
| `/settings` | 설정 | 서버 연결 방식·포트 상태(`/api/link`), 접속 주소(폰용 QR 코드는 선택), PIN 입력, 움직임 줄이기, 경고 소리 켜기. **mock 모드일 때만** "고장 재현" 패널: 구역 선택 + 시나리오 버튼 11개 → `POST /api/mock/scenario` (시연용) |
| 노트북 ≥1024px | **10 대시보드** | `/`가 3단 대시보드로 바뀐다: 위에 Gradient Text 제목 + 섬 + 연결 정보 + 모두 정지. 구역 카드 3개 가로(Glare Hover). 아래 왼쪽 큰 그래프, 오른쪽 진단 목록. 하단 Dock |

**빈 상태·오류 상태** (모든 화면):
- 서버 연결 중: Lattice Loader + "서버에 연결하는 중…"
- 구역이 하나도 없음: "아직 ESP32 신호가 없어요. 서버 콘솔에 포트가 연결됐는지 확인하세요" + [시험 모드로]
- 구역 오프라인: 카드 회색, "마지막 값 · 3분 전", 그 구역 급수·보정 버튼 비활성

### 7. 보정 마법사 상세

**로드셀 (`scale`)**
1. "계량판을 비우세요" → [영점 잡기] → `tare` (최대 5초 대기, 진행 표시) → ack ok면 offset 표시
2. "무게를 아는 물건을 올리세요" + 숫자 입력(기본 500g) + 지금 읽는 무게, 안정되면 [보정] → `cal <g>`
3. "확인": 지금 무게가 입력값 ±2% 안이면 초록 체크. "물건을 내리면 0 근처로 돌아와야 해요"

**토양 (`soil`)**: A, B를 각각
1. "센서를 공기 중에 들고 있으세요" → 지금 mV + 안정 표시 → `soilcal a air`
2. "경계선까지 물컵에 꽂으세요" → `soilcal a wet`
3. 확인: air − wet ≥ 500mV면 정상. 아니면 "차이가 너무 작아요. 센서나 배선을 확인하세요"

**펌프 유량 (`flow`)** — 두 가지 방법 중 고른다
- **자동 (로드셀 보정이 되어 있을 때 권장)**: "출수구 아래에 화분이 있어요. 10초 동안 펌프를 돌려 늘어난 무게로 유량을 잽니다" → [측정] → `POST /api/nodes/{node}/flow-cal/run {"ms":10000}` → 진행 표시 → 결과 "10초에 23.5g → 2.35 mL/s" → [저장] → `flow 10000 23.5`
- **수동 (컵과 저울)**: 출수구 아래에 컵을 두고 [10초 돌리기] → 같은 run API → 받은 물 무게(g) 입력 → [저장]

### 8. 접근성·품질

- 모든 버튼은 `<button>`, 이동은 `<a>`/`<Link>`. 아이콘 버튼에는 `aria-label`.
- 게이지·그래프 SVG에는 `role="img"`와 값이 들어간 `aria-label`.
- 키보드로 모든 기능을 쓸 수 있어야 한다 (Hold Button 포함).
- 글자 대비 4.5:1 이상 (2절 색 그대로 쓰면 통과).
- 한 화면의 동시 애니메이션은 최소로. 숫자 Count Up은 값이 바뀔 때만 실행한다.
- 성능: 노트북 첫 화면 3초 안. 그래프·WebGL 컴포넌트는 `React.lazy`로 늦게 불러온다. 8시간 켜 두어도 메모리가 계속 늘지 않게, 목록 길이를 제한한다.
- ESLint + Prettier. `npm run build`에서 타입 오류 0개.

### 9. 폴더 구조

```
web/
├─ COMPONENTS.md              설치 성공/대체 목록
├─ public/zones/              Z1.jpg … (선택)
├─ src/
│  ├─ main.tsx, App.tsx, routes.tsx
│  ├─ styles/tokens.css, globals.css
│  ├─ types/api.ts
│  ├─ lib/ws.ts, api.ts, format.ts, motion.ts(reduced motion)
│  ├─ store/useAppStore.ts
│  ├─ hooks/useNow.ts, useNode.ts, usePreflight.ts, useHistory.ts
│  ├─ components/
│  │  ├─ ui/                  shadcn, cult-ui 원본
│  │  ├─ react-bits/          React Bits 원본
│  │  ├─ fx/                  래퍼·대체 구현 (HoldButton, StatusDot, Background …)
│  │  ├─ layout/              AppShell, TabBar, DesktopDock, StopAllButton
│  │  └─ domain/              ZoneCard, SensorCard, Gauge, ABCompare, DiagnosticCard, PreflightList, Sparkline
│  └─ features/
│     ├─ island/              IslandController, IslandContent
│     ├─ home/, zone/, sensor/, water/, diagnostics/, calibrate/, history/, test/, settings/
```

### 10. 마일스톤 (하나씩)

| # | 할 일 | 확인 방법 |
|---|---|---|
| **W1** | Vite + TS + Tailwind v4 + shadcn 설정, 글꼴, 토큰, `AppShell`(배경 그라데이션, 하단 탭 바, 모두 정지 버튼 모양만), 라우트 빈 화면 10개, Vite 프록시 | `npm run dev` → 폰에서 `http://<노트북IP>:5173` 열림, 탭 이동 됨 |
| **W2** | React Bits·cult-ui 설치 + `COMPONENTS.md` + 래퍼(`fx/`) + reduced motion 처리 | 데모 페이지 `/dev/fx`에서 각 컴포넌트가 보임 (빌드에서 제외) |
| **W3** | 타입 + WebSocket + store + REST 래퍼 + `useNow` | 서버 mock 켜고 개발자 도구에서 store에 3구역 값이 5초(또는 1초)마다 바뀜. 서버를 끄면 conn=closed, 켜면 다시 open |
| **W4** | Dynamic Island 컨트롤러 (4절 표 전부) | 설정의 고장 재현 또는 Swagger로: 정상 → `sht_b_hot`(compactLong) → `soil_a_unplugged`(tall→compactLong) → 급수(large+정지) → 서버 끄기(minimalLeading) |
| **W5** | 01 홈 + 05 진단 목록 + 모두 정지 동작 | mock 시나리오를 켜면 홈 카드 색·배지와 진단 목록이 서버 진단과 정확히 같음 |
| **W6** | 02 구역 상세 (게이지, 보기 전환, A·B 비교, 미니 그래프) + 03 센서 상세 | `sht_b_hot`에서 게이지의 B 눈금이 벌어지고, 센서 상세에 원인·확인 방법이 나옴 |
| **W7** | 04 급수 (preflight, Elastic Slider, Hold Button, 급수 중 정지, 결과) | Z1 10mL → 섬 large → 끝나면 "+9.6g 도착 · 정상". Z3(유량 보정 전)는 [유량 보정하기]. `estop_pressed`에서 버튼 비활성 + 이유 |
| **W8** | 06 보정 마법사 3종 | mock에서 로드셀 3단계 완료, 토양 A·B, 유량 자동 측정까지 ack 기반으로 진행 |
| **W9** | 07 기록 (그래프, 급수선, 진단 띠, 사건, 메모, CSV) | 1시간 그래프에 급수 시점 세로선, CSV 다운로드 |
| **W10** | 08 시험 모드 + 설정(고장 재현 패널, PIN) | ESP32에 `02_soil` 올리고 서버 serial 모드 → 시험 모드에서 값과 자동 체크, `air a` 보내기 |
| **W11** | 노트북 대시보드(≥1024px) + Dock + 마무리(빈·오류 상태, 접근성 점검, 성능) | 1280px에서 와이어프레임 10번 배치. 키보드만으로 급수까지 가능 |
| **W12** | 빌드 → `web/dist`를 서버가 띄우기, README(실행 두 줄) | 서버만 켜고 `http://<노트북IP>:8000`에서 전체 동작 |

### 11. 하지 말 것

- 진단 규칙·기준값·한국어 진단 문구를 웹앱에 하드코딩하는 것 (서버가 준다)
- 급수를 한 번 클릭으로 실행하는 UI, 정지 버튼을 숨기거나 확인 창을 띄우는 것
- 숫자 위에 계속 움직이는 효과를 얹는 것, 화면에 WebGL 배경 2개 이상
- 서버 주소 하드코딩 (상대 경로만)
- 설치된 React Bits·cult-ui 원본 파일을 말없이 고치는 것
- 이모지 아이콘

시작: **W1만** 진행하고 멈춰라.
