# 설치한 컴포넌트 (React Bits · cult-ui)

설치 명령: `npx shadcn@latest add @react-bits/<이름>-TS-TW` · `npx shadcn@latest add @cult-ui/dynamic-island`
원본 위치: `src/components/react-bits/`, `src/components/ui/` — **원본은 고치지 않고** `src/components/fx/`의 래퍼로 쓴다.
모든 래퍼는 움직임 줄이기(운영체제 설정 또는 앱 설정)이면 정지 화면이나 일반 글자로 바뀐다.

## 설치 결과

| 컴포넌트 | 결과 | 래퍼 (`src/components/fx/`) | 어디에 | 비고 |
|---|---|---|---|---|
| Dynamic Island (cult-ui) | 성공 | `features/island/` (W4) | 모든 화면 맨 위 | **원본 1줄 수정** (`// MODIFIED:` 표시): TypeScript `verbatimModuleSyntax` 때문에 `ReactNode`를 type import로. 동작 변화 없음 |
| SoftAurora | 성공 | `Background` | 앱 배경 | 파랑 2색, 불투명도 0.3. 움직임 줄이기·탭 숨김이면 내려가고 정지 그라데이션. WebGL 배경은 이것 하나 |
| BlurText | 성공 | `IntroText` | 홈 인사말 | 세션당 처음 1번만. `<p>`를 그리므로 `<div>` 안에 둔다 |
| RotatingText | 성공 | `RotatingWords` | 홈 부제 | 3초 간격 |
| CountUp | 성공 | `CountNumber` | 게이지·통계 숫자 | 값이 바뀔 때만 0.4초, 처음 표시 때 0부터 세지 않음 |
| DecryptedText | 성공 | `DecryptTitle` | 새 진단 제목 | 원래 글자만 섞음, 약 0.6초 |
| ShinyText | 성공 | `Shiny` | '실시간', 섬의 '급수 중' | |
| GradientText | 성공 | `GradientTitle` | 노트북 화면 제목 | 파랑 계열만 |
| PillNav | 성공 | `PillTabs` | 구역 탭 Z1·Z2·Z3 | react-router `Link`로 이동 (링크 의미 유지) |
| TiltedCard | 성공 | `TiltBox` | 홈 구역 카드 | 마우스(hover 가능)에서만. 터치에서는 일반 카드 |
| SpotlightCard | 성공 | `SpotlightBox` | 센서 카드 | 밝은 테마, `rgba(47,107,255,.12)` |
| BorderGlow | 성공 | `GlowBox` | A·B 비교 카드(주의) | 마우스가 가까워야 빛나는 효과라, **터치폰에서도 보이게 주황 테두리를 항상 깔고** 처음 1번 빛이 테두리를 돈다 |
| ElectricBorder | 성공 | `ElectricBox` | 고장 카드 | 화면당 1개만 (먼저 붙은 카드). 나머지는 빨간 테두리로 대체 |
| AnimatedList | 성공 | `EventList` | 기록 화면 사건 목록 | 선택형 `listbox`라 **고르면 그래프에 표시하는 곳에만** 사용 |
| AnimatedList (진단 목록·사전 점검) | **대체** | `FxList` (motion layout) | 진단 목록, 켜기 전 점검 | 카드 안에 버튼(보정하기·자세히)이 있어 `listbox/option` 안에 버튼을 넣으면 접근성 오류. 새 항목이 위에서 들어오는 동작은 같게 구현 |
| AnimatedContent | 성공 | `Reveal` | 화면 섹션 등장 | 18px, 0.3초 |
| FadeContent | 성공 | `FadeIn` | 화면 섹션 등장 | 0.3초 |
| ElasticSlider | 성공 | `AmountSlider` | 급수량 0~50mL, 5 단위 | `role=slider`, 화살표 키로 조절 |
| Stepper | 성공 | `Steps`, `Step` | 보정 마법사 | `step`을 부모가 정함 (ack가 ok여야 다음), 자체 버튼 숨김 |
| Counter | 성공 | `RollNumber` | 오늘 급수량 | 처음 표시 때 굴리지 않음 |
| Dock | 성공 | `layout/DesktopDock` | 노트북 하단 메뉴 | 확대는 마우스에서만 |
| ClickSpark | 성공 | `Sparks` | 앱 전체 | 파랑, 작게. 정지 버튼은 빨강 (W5) |
| Magnet | 성공 | `MagnetWrap` | 노트북 급수 버튼 | padding 40, strength 3, 마우스에서만 |
| GlareHover | 성공 | `GlareBox` | 노트북 구역 카드 | 마우스에서만 |
| GradualBlur | 성공 | `BottomBlur` | 스크롤 목록 아래 | 모바일만 |
| GlassSurface | 성공 | `Glass` | 하단 탭 바, 상단 헤더 | 지원 안 하면 원본이 `backdrop-filter`로 대체 |

## Micro 카테고리

| 컴포넌트 | 결과 | 래퍼 | 어디에 | 비고 |
|---|---|---|---|---|
| HoldButton | 성공 | `HoldAction` | 급수 실행 (1초) | 누르는 동안 채워짐, 1초 전에 떼면 취소, **Space·Enter 길게 누르기**, Esc 취소 (원본 지원) |
| SloshGauge | 성공 | `WaterGauge` | 급수 화면의 물 원 | 0~100% → 급수량/50mL. 원 모양(지름=너비), 숫자는 위에 겹쳐 움직이지 않음 |
| StatusMark | 성공 | `CheckMark` | 사전 점검 통과·실패 | 상태 배지·점은 `StatusBadge`·`StatusDot`(색+글자+아이콘, UI-05) |
| SpringCheck | 성공 | `CheckItem` | 진단 '확인 방법' 체크리스트 | |
| RubberSegment | 성공 | `Segment` | 진단 필터 | |
| GlideSelect | 성공 | `PeriodSelect` | 기록 기간 1·6·24시간 | |
| PromptBar | 성공 | `CommandBar` | 시험 모드 명령 입력 | 모델·노력 선택 등은 빈 목록으로 숨김 |
| SwipeToast | 성공 | `ToastHost` + `store/useToasts` | 명령 결과 알림 | 탭 바·정지 버튼 위에 최근 3개까지 |
| PulseHeart | **대체** | `PulseDot` | 데이터 받을 때 뛰는 '살아 있음' 표시 | 원본은 **클릭할 때만 뛰는 '좋아요' 토글 버튼**(`aria-pressed`)이라 데이터 도착에 맞춰 뛰게 할 수 없고, 버튼으로 읽혀 접근성에도 맞지 않음. 점 scale 펄스로 대체 |
| SquishSwitch | 성공 | `Toggle` | 설정 스위치 | |
| LatticeLoader | 성공 | `Loader` | 서버 연결 중 | |

## 확인

`npm run dev` 후 `http://localhost:5173/dev/fx` (개발 모드에서만 있고, `npm run build` 결과에는 들어가지 않음).
설정 스위치로 '움직임 줄이기'를 켜면 배경이 정지 그라데이션, 글자 효과가 일반 글자, 전기 테두리가 일반 테두리로 바뀐다.
