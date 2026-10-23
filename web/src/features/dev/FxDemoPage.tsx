import { useEffect, useState, type ReactNode } from 'react'
import { ScreenHeader } from '@/components/layout/ScreenHeader'
import { ElectricBox, GlareBox, GlowBox, SpotlightBox, TiltBox } from '@/components/fx/cards'
import { CountNumber } from '@/components/fx/CountNumber'
import { HoldAction } from '@/components/fx/HoldAction'
import { AmountSlider, CheckItem, CommandBar, PeriodSelect, Segment, Toggle } from '@/components/fx/inputs'
import { EventList, FxList } from '@/components/fx/lists'
import { FadeIn, Loader, MagnetWrap, PillTabs, Reveal, RollNumber, Step, Steps } from '@/components/fx/misc'
import { CheckMark, PulseDot, StatusBadge, StatusDot } from '@/components/fx/status'
import { DecryptTitle, GradientTitle, IntroText, RotatingWords, Shiny } from '@/components/fx/texts'
import { WaterGauge } from '@/components/fx/WaterGauge'
import { useSettings } from '@/store/useSettings'
import { toast } from '@/store/useToasts'

function Demo({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="card card-pad">
      <p className="caption mb-3 font-mono">{name}</p>
      {children}
    </section>
  )
}

/** 개발용 데모 (/dev/fx): 설치한 React Bits·cult-ui 래퍼가 모두 보이는지 확인. 빌드에서는 빠진다 */
export default function FxDemoPage() {
  const [n, setN] = useState(23.4)
  const [ml, setMl] = useState(10)
  const [seg, setSeg] = useState('all')
  const [period, setPeriod] = useState('60')
  const [on, setOn] = useState(true)
  const [checked, setChecked] = useState(false)
  const [beat, setBeat] = useState(0)
  const [step, setStep] = useState(1)
  const [list, setList] = useState(['첫 번째 진단'])
  const reduced = useSettings((s) => s.reducedMotion)
  const setReduced = useSettings((s) => s.setReducedMotion)

  useEffect(() => {
    const t = setInterval(() => {
      setN((v) => Math.round((v + (Math.random() - 0.5)) * 10) / 10)
      setBeat((b) => b + 1)
    }, 2500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title="fx 데모" sub="React Bits · cult-ui 래퍼 (개발용)" back="/" />
      <Demo name="움직임 줄이기 (UI-09)">
        <div className="flex items-center justify-between">
          <span>앱 설정으로 끄기</span>
          <Toggle checked={reduced} onChange={setReduced} label="움직임 줄이기" />
        </div>
      </Demo>
      <Demo name="BlurText · RotatingText · GradientText · ShinyText · DecryptedText">
        <div className="text-[22px] font-extrabold">
          <IntroText text="안녕하세요, 참값팀" />
        </div>
        <p className="mt-1 text-ink-2">
          지금 확인 중: <RotatingWords words={['온도', '습도', '토양', '무게']} className="font-bold text-brand" />
        </p>
        <p className="mt-2 text-[20px] font-extrabold">
          <GradientTitle text="참값 센서 진단" />
        </p>
        <p className="mt-2 font-bold">
          <Shiny text="실시간" />
        </p>
        <p className="mt-2 font-bold">
          <DecryptTitle text="온습도 A·B 차이가 큼" />
        </p>
      </Demo>
      <Demo name="CountUp (값이 바뀔 때만) · Counter">
        <div className="flex items-end gap-4">
          <span className="big-num">
            <CountNumber value={n} decimals={1} />
            <span className="text-[20px]">°C</span>
          </span>
          <span className="text-[22px] font-extrabold">
            <RollNumber value={ml * 3} /> / 300 mL
          </span>
        </div>
      </Demo>
      <Demo name="상태 배지 · 점 · StatusMark · PulseDot(대체)">
        <div className="flex flex-wrap gap-2">
          {(['ok', 'info', 'warn', 'fault', 'offline'] as const).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <StatusDot status="ok" label="3구역 연결" />
          <CheckMark state="ok" />
          <CheckMark state="fail" />
          <CheckMark state="running" />
          <PulseDot beat={beat} />
        </div>
      </Demo>
      <Demo name="SpotlightCard · TiltedCard(마우스만) · GlareHover(마우스만)">
        <div className="grid grid-cols-2 gap-3">
          <SpotlightBox className="card-pad">
            <p className="card-title">온습도 A (대상)</p>
            <p className="big-num mt-2 text-[32px]">23.4°</p>
          </SpotlightBox>
          <TiltBox className="card card-pad">
            <p className="card-title">기울이기</p>
            <p className="caption">터치에서는 꺼짐</p>
          </TiltBox>
        </div>
        <GlareBox className="card card-pad mt-3">
          <p className="card-title">Glare Hover</p>
        </GlareBox>
      </Demo>
      <GlowBox active className="card-pad">
        <p className="card-title">BorderGlow — A·B 비교 (주의)</p>
        <p className="caption">B가 A보다 2.7°C 높음</p>
      </GlowBox>
      <ElectricBox className="card-pad">
        <p className="card-title">ElectricBorder — 고장 카드 (화면당 1개)</p>
        <p className="caption">온습도 B 응답 없음</p>
      </ElectricBox>
      <ElectricBox className="card-pad">
        <p className="card-title">두 번째 고장 카드 → 테두리로 대체</p>
      </ElectricBox>
      <Demo name="SloshGauge · ElasticSlider · HoldButton · Magnet">
        <WaterGauge ml={ml}>
          <span className="big-num">{ml}</span>
          <span className="caption font-bold">mL</span>
        </WaterGauge>
        <div className="mt-4">
          <AmountSlider value={ml} onChange={setMl} />
        </div>
        <div className="mt-4">
          <MagnetWrap>
            <HoldAction onHold={() => toast.ok('급수 요청함', `Z1 ${ml}mL`)} />
          </MagnetWrap>
        </div>
      </Demo>
      <Demo name="RubberSegment · GlideSelect · SquishSwitch · SpringCheck">
        <Segment
          label="진단 필터"
          value={seg}
          onChange={setSeg}
          items={[
            { value: 'all', label: '전체 4' },
            { value: 'fault', label: '고장 1' },
            { value: 'warn', label: '주의 2' },
            { value: 'info', label: '정보 1' },
          ]}
        />
        <div className="mt-3 flex items-center gap-3">
          <PeriodSelect
            label="기간"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '60', label: '1시간' },
              { value: '360', label: '6시간' },
              { value: '1440', label: '24시간' },
            ]}
          />
          <Toggle checked={on} onChange={setOn} label="경고 소리" />
        </div>
        <div className="mt-3">
          <CheckItem label="A·B를 바꿔 끼워 본다" checked={checked} onChange={setChecked} />
        </div>
      </Demo>
      <Demo name="PillNav (구역 탭)">
        <PillTabs
          label="구역"
          activeHref="/dev/fx"
          items={[
            { label: 'Z1', href: '/dev/fx', icon: <span className="mr-1 size-2 rounded-full bg-ok" /> },
            { label: 'Z2', href: '/zone/Z2', icon: <span className="mr-1 size-2 rounded-full bg-warn-dot" /> },
            { label: 'Z3', href: '/zone/Z3', icon: <span className="mr-1 size-2 rounded-full bg-info" /> },
          ]}
        />
      </Demo>
      <Demo name="Stepper (ack가 와야 다음)">
        <Steps step={step}>
          <Step title="영점">계량판을 비우세요</Step>
          <Step title="무게">아는 무게를 올리세요</Step>
          <Step title="확인">0 근처로 돌아와야 해요</Step>
        </Steps>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="tap rounded-xl bg-surface-2 px-3"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            이전
          </button>
          <button
            type="button"
            className="tap rounded-xl bg-brand px-3 text-white"
            onClick={() => setStep((s) => s + 1)}
          >
            실행 (ack ok 가정)
          </button>
        </div>
      </Demo>
      <Demo name="motion layout 목록 (AnimatedList 대체) · AnimatedList(선택형)">
        <button
          type="button"
          className="tap mb-3 rounded-xl bg-primary-soft px-3 font-bold text-brand"
          onClick={() => setList((l) => [`새 진단 ${l.length + 1}`, ...l])}
        >
          항목 추가
        </button>
        <FxList items={list} getKey={(x) => x} render={(x) => <div className="cell p-3">{x}</div>} />
        <div className="mt-4">
          <EventList
            items={[
              { title: '급수 10mL', description: '+9.6g 도착 · 정상', meta: '14:02' },
              { title: '진단 시작: 온습도 A·B 차이', description: '주의', meta: '13:40' },
              { title: '메모', description: '센서 B 위치 옮김', meta: '13:12' },
            ]}
            maxHeight={220}
          />
        </div>
      </Demo>
      <Demo name="PromptBar (시험 모드 명령)">
        <CommandBar onSend={(t) => toast.info('보냄', t)} />
      </Demo>
      <Demo name="LatticeLoader · AnimatedContent · FadeContent">
        <Loader />
        <Reveal className="cell mt-3 p-3">Animated Content</Reveal>
        <FadeIn className="cell mt-3 p-3">Fade Content</FadeIn>
      </Demo>
      <Demo name="SwipeToast">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="tap rounded-xl bg-ok-soft px-3 font-bold text-ok"
            onClick={() => toast.ok('Z1 정지함')}
          >
            성공
          </button>
          <button
            type="button"
            className="tap rounded-xl bg-fault-soft px-3 font-bold text-fault"
            onClick={() => toast.error('급수를 막았어요', '12V가 없어요 (비상정지·퓨즈 확인)')}
          >
            실패
          </button>
        </div>
      </Demo>
    </div>
  )
}
