import { useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Check, ChevronRight } from 'lucide-react'
import {
  Cell,
  GhostButton,
  HoldButton,
  LimeButton,
  Panel,
  PanelHeader,
  PillTabs,
  StatusLabel,
  ZoneTitle,
} from '@/components/ds/ui'
import { useNode } from '@/hooks/useNode'
import { useNow } from '@/hooks/useNow'
import { commandTimeoutMs, sendCommand, type CommandOutcome } from '@/lib/commands'
import { parseTs } from '@/lib/nodeState'
import { isNum } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { NodeId, NodeState } from '@/types/api'

/**
 * 보정 마법사 (요구사항 03_PROMPT 7절): 토양 · 로드셀 · 유량.
 * 단계마다 ESP32에 명령을 보내고, 결과(ack)가 성공이어야 다음 단계로 간다. 실패하면 이유를 보이고 그 단계에 남는다.
 * 보정값은 ESP32 안(NVS)에 저장돼 전원을 꺼도 남는다.
 */

type Kind = 'soil' | 'scale' | 'flow'
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'soil', label: '토양' },
  { kind: 'scale', label: '로드셀' },
  { kind: 'flow', label: '유량' },
]

// ------------------------------------------------------------ 공통 조각

function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="mb-4 flex items-center gap-2" aria-label="단계">
      {labels.map((l, i) => (
        <li key={l} className="flex flex-1 items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cn(
              'flex size-[26px] shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold',
              i < current
                ? 'border-transparent bg-[var(--ds-lime)] text-[var(--ds-btn-lime-ink)]'
                : i === current
                  ? 'border-[var(--ds-lime)] text-white'
                  : 'border-white/25 text-white/50',
            )}
          >
            {i < current ? <Check size={14} strokeWidth={2.5} /> : i + 1}
          </span>
          <span className={cn('truncate text-[12.5px]', i === current ? 'text-white' : 'text-ds-text-3')}>{l}</span>
          {i < labels.length - 1 ? <span aria-hidden className="h-px flex-1 bg-white/15" /> : null}
        </li>
      ))}
    </ol>
  )
}

/** 지금 읽는 값 + 안정 여부 */
function Live({
  label,
  value,
  unit,
  stable,
  note,
}: {
  label: string
  value: string
  unit?: string
  stable: boolean | null
  note?: string
}) {
  return (
    <Cell className="mt-3 flex items-end justify-between gap-3 px-4 py-3.5">
      <div>
        <div className="text-[12px] text-ds-text-2">{label}</div>
        <div className="num text-[34px] leading-tight whitespace-nowrap">
          {value}
          {unit ? <span className="ml-1 text-[16px] text-ds-text-2">{unit}</span> : null}
        </div>
        {note ? <div className="text-[11px] text-ds-text-3">{note}</div> : null}
      </div>
      {stable == null ? (
        <StatusLabel status="offline" text="값 없음" />
      ) : stable ? (
        <StatusLabel status="ok" text="안정됨" />
      ) : (
        <StatusLabel status="warn" text="흔들리는 중" />
      )}
    </Cell>
  )
}

/** 명령 하나를 보내고 결과를 기다리는 버튼. 성공하면 onOk, 실패하면 이유를 보인다 */
function useRun(id: NodeId) {
  const [busy, setBusy] = useState<{ cmd: string; since: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (cmd: string, onOk: (o: CommandOutcome) => void) => {
    setBusy({ cmd, since: Date.now() })
    setError(null)
    const o = await sendCommand(id, cmd)
    setBusy(null)
    if (o.ok) onOk(o)
    else setError(o.message.replace(/^[^:]+:\s*/, ''))
  }
  return { busy, error, run, clear: () => setError(null) }
}

function RunState({ busy, error }: { busy: { cmd: string; since: number } | null; error: string | null }) {
  const now = useNow()
  const offset = useAppStore((st) => st.clockOffsetMs)
  if (busy) {
    const s = Math.max(0, Math.round((now - offset - busy.since) / 1000))
    const total = Math.round(commandTimeoutMs(busy.cmd) / 1000)
    return (
      <p className="mt-3 text-center text-[12.5px] text-ds-text-2" aria-live="polite">
        보드가 실행 중이에요… {s}초 (최대 {total}초)
      </p>
    )
  }
  if (error) {
    return (
      <p className="mt-3 text-center" role="alert">
        <StatusLabel status="warn" text={error} />
      </p>
    )
  }
  return null
}

/** 최근 측정값 n개의 흔들림 (같은 구역, 20초 안) */
function useRecentRange(id: NodeId, key: 'soil_a_mv' | 'soil_b_mv' | 'weight_raw') {
  const recent = useAppStore((s) => s.recent[id])
  const now = useNow()
  const xs = (recent ?? [])
    .filter((d) => now - parseTs(d.created_at) < 20_000)
    .map((d) => d[key])
    .filter(isNum)
    .slice(-4)
  if (xs.length < 2) return null
  return Math.max(...xs) - Math.min(...xs)
}

function Missing({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-5 text-center text-[13.5px] text-ds-text-2">
      {children}
    </p>
  )
}

// ------------------------------------------------------------ 토양

function SoilWizard({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const present = { a: node?.sensors.soil_a.present ?? true, b: node?.sensors.soil_b.present ?? true }
  const [ch, setCh] = useState<'a' | 'b'>(present.a || !present.b ? 'a' : 'b')
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState<{ air?: number; wet?: number }>({})
  const r = useRun(id)
  const mvKey = ch === 'a' ? 'soil_a_mv' : 'soil_b_mv'
  const mv = node?.latest?.[mvKey]
  const range = useRecentRange(id, mvKey)
  const online = !!node?.online
  const info = node?.info
  const air = saved.air ?? (ch === 'a' ? info?.soil_a_air : info?.soil_b_air)
  const wet = saved.wet ?? (ch === 'a' ? info?.soil_a_wet : info?.soil_b_wet)
  const diff = isNum(air) && isNum(wet) ? air - wet : null
  const parse = (o: CommandOutcome) => Number(String(o.result?.msg ?? '').split('=')[1])

  if (!present.a && !present.b) return <Missing>이 구역에는 토양 센서가 없어요.</Missing>
  return (
    <>
      <div className="mb-3 flex gap-2" role="radiogroup" aria-label="토양 센서">
        {(['a', 'b'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={ch === c}
            disabled={!present[c]}
            onClick={() => {
              setCh(c)
              setStep(0)
              setSaved({})
              r.clear()
            }}
            className={cn(
              'h-[38px] flex-1 rounded-full border text-[14px]',
              ch === c ? 'border-transparent bg-[var(--ds-green)] font-semibold' : 'border-white/15 bg-white/[0.06]',
              !present[c] && 'opacity-40',
            )}
          >
            토양 {c.toUpperCase()} ({c === 'a' ? '대상' : '비교'}){present[c] ? '' : ' · 미설치'}
          </button>
        ))}
      </div>
      <Steps labels={['공기 중', '물속', '확인']} current={step} />
      {step === 0 ? (
        <>
          <p className="text-[15px] leading-relaxed">
            센서를 흙에서 빼서 <b>공기 중에</b> 들고 있으세요. 손이 금속 부분에 닿지 않게요.
          </p>
          <Live
            label={`토양 ${ch.toUpperCase()} 지금 값`}
            value={isNum(mv) ? String(mv) : '--'}
            unit="mV"
            stable={range == null ? null : range <= 30}
          />
          <div className="mt-4">
            <LimeButton
              disabled={!online || !!r.busy}
              onClick={() =>
                void r.run(`soilcal ${ch} air`, (o) => {
                  setSaved((s) => ({ ...s, air: parse(o) }))
                  setStep(1)
                })
              }
            >
              공기 값 저장
            </LimeButton>
          </div>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <p className="text-[15px] leading-relaxed">
            센서를 <b>경계선(흰 선)까지</b> 물컵에 꽂으세요. 선보다 깊이 넣지 마세요.
          </p>
          <Live
            label={`토양 ${ch.toUpperCase()} 지금 값`}
            value={isNum(mv) ? String(mv) : '--'}
            unit="mV"
            stable={range == null ? null : range <= 30}
          />
          <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2.5">
            <GhostButton onClick={() => setStep(0)}>이전</GhostButton>
            <LimeButton
              disabled={!online || !!r.busy}
              onClick={() =>
                void r.run(`soilcal ${ch} wet`, (o) => {
                  setSaved((s) => ({ ...s, wet: parse(o) }))
                  setStep(2)
                })
              }
            >
              물 값 저장
            </LimeButton>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Cell className="px-4 py-4">
            <div className="grid grid-cols-3 text-center">
              <div>
                <div className="text-[12px] text-ds-text-2">공기</div>
                <div className="num text-[22px]">{isNum(air) ? air : '--'}</div>
              </div>
              <div>
                <div className="text-[12px] text-ds-text-2">물</div>
                <div className="num text-[22px]">{isNum(wet) ? wet : '--'}</div>
              </div>
              <div>
                <div className="text-[12px] text-ds-text-2">차이 (mV)</div>
                <div className="num text-[22px]">{diff ?? '--'}</div>
              </div>
            </div>
          </Cell>
          <p className="mt-3 text-center">
            {diff != null && diff >= 500 ? (
              <StatusLabel status="ok" text="보정 완료 · 이제 토양 값이 0(공기) ~ 1(물)로 나와요" />
            ) : (
              <StatusLabel
                status="warn"
                text="차이가 너무 작아요 (500mV 이상이어야 해요). 센서·배선을 확인하고 다시 해 보세요"
              />
            )}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <GhostButton
              onClick={() => {
                setStep(0)
                setSaved({})
              }}
            >
              처음부터
            </GhostButton>
            <LimeButton to={`/zone/${id}/sensor/soil`}>토양 화면으로</LimeButton>
          </div>
        </>
      ) : null}
      <RunState busy={r.busy} error={r.error} />
    </>
  )
}

// ------------------------------------------------------------ 로드셀

function ScaleWizard({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const [step, setStep] = useState(0)
  const [grams, setGrams] = useState('500')
  const r = useRun(id)
  const d = node?.latest
  const range = useRecentRange(id, 'weight_raw')
  const raw = d?.weight_raw
  const stable =
    d?.hx_ok === 1 && isNum(raw) ? (range == null ? null : range <= Math.max(200, Math.abs(raw) * 0.002)) : null
  const g = Number(grams)
  const gOk = Number.isFinite(g) && g >= 10 && g <= 10_000
  const w = d?.weight_g
  const within = isNum(w) && gOk ? Math.abs(w - g) <= g * 0.02 : null
  const online = !!node?.online

  if (node && !node.sensors.scale.present) return <Missing>이 구역에는 로드셀(무게 센서)이 없어요.</Missing>
  return (
    <>
      <Steps labels={['영점', '무게 올리기', '확인']} current={step} />
      {step === 0 ? (
        <>
          <p className="text-[15px] leading-relaxed">
            계량판을 <b>비우세요</b> (화분을 내려 주세요). 판이 다른 데 닿지 않게 해 주세요.
          </p>
          <Live label="지금 원시값 (raw)" value={isNum(raw) ? raw.toLocaleString('en-US') : '--'} stable={stable} />
          <div className="mt-4">
            <LimeButton disabled={!online || !!r.busy} onClick={() => void r.run('tare', () => setStep(1))}>
              영점 잡기 (약 2초)
            </LimeButton>
          </div>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <p className="text-[15px] leading-relaxed">무게를 아는 물건을 판 가운데에 올리고, 그 무게를 적으세요.</p>
          <label className="mt-3 flex items-center gap-3">
            <span className="text-[13px] text-ds-text-2">올린 무게</span>
            <input
              inputMode="numeric"
              value={grams}
              onChange={(e) => setGrams(e.target.value.replace(/[^0-9.]/g, ''))}
              className="num h-[44px] w-[120px] rounded-[12px] border border-white/20 bg-white/[0.08] px-3 text-[18px] text-white outline-none focus:border-[var(--ds-lime)]"
              aria-label="올린 무게 (g)"
            />
            <span className="text-[13px] text-ds-text-2">g</span>
          </label>
          <Live label="지금 원시값 (raw)" value={isNum(raw) ? raw.toLocaleString('en-US') : '--'} stable={stable} />
          <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2.5">
            <GhostButton onClick={() => setStep(0)}>이전</GhostButton>
            <LimeButton disabled={!online || !gOk || !!r.busy} onClick={() => void r.run(`cal ${g}`, () => setStep(2))}>
              보정
            </LimeButton>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Live
            label="지금 무게"
            value={isNum(w) ? w.toFixed(1) : '--'}
            unit="g"
            stable={stable}
            note={`올린 무게 ${g} g (±2% 안이면 정상)`}
          />
          <p className="mt-3 text-center">
            {within == null ? (
              <StatusLabel status="offline" text="무게 값을 기다리는 중" />
            ) : within ? (
              <StatusLabel status="ok" text="보정 완료 · 물건을 내리면 0 근처로 돌아와야 해요" />
            ) : (
              <StatusLabel status="warn" text="올린 무게와 2% 넘게 달라요. 다시 보정해 보세요" />
            )}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <GhostButton onClick={() => setStep(0)}>처음부터</GhostButton>
            <LimeButton to={`/zone/${id}/sensor/weight`}>무게 화면으로</LimeButton>
          </div>
        </>
      ) : null}
      <RunState busy={r.busy} error={r.error} />
    </>
  )
}

// ------------------------------------------------------------ 유량

function FlowWizard({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const [step, setStep] = useState(0)
  const [delta, setDelta] = useState<number | null>(null)
  const r = useRun(id)
  const online = !!node?.online
  const noPump = node ? !node.sensors.pump.present : false
  const noScale = node ? !node.sensors.scale.present : false
  const lcCal = node?.info?.lc_cal === 1
  const mlps = node?.info?.pump_mlps

  if (noPump) return <Missing>이 구역에는 펌프가 없어요.</Missing>
  if (noScale) return <Missing>유량은 무게로 잽니다. 이 구역에는 로드셀이 없어요.</Missing>
  if (!lcCal) {
    return (
      <Missing>
        로드셀 보정이 먼저예요.{' '}
        <Link to={`/calibrate/${id}/scale`} className="inline-flex items-center text-[var(--ds-lime)] underline">
          로드셀 보정하기 <ChevronRight size={14} />
        </Link>
      </Missing>
    )
  }
  return (
    <>
      <Steps labels={['10초 측정', '저장']} current={step} />
      {step === 0 ? (
        <>
          <p className="text-[15px] leading-relaxed">
            출수구 아래 화분(또는 컵)이 <b>저울 위에</b> 있어야 해요. 10초 동안 펌프를 돌려 늘어난 무게로 유량을 잽니다.
            끝까지 1분 남짓 걸려요.
          </p>
          <div className="mt-4">
            <HoldButton
              disabled={!online || !!r.busy}
              hint={r.busy ? '측정 중…' : '1초 길게 누르기 · 펌프가 10초 돌아요'}
              onHold={() =>
                void r.run('flowcal 10000', (o) => {
                  const dg = Number(o.result?.delta_g)
                  setDelta(Number.isFinite(dg) ? dg : null)
                  setStep(1)
                })
              }
            >
              측정 시작
            </HoldButton>
          </div>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Cell className="px-4 py-4 text-center">
            <div className="text-[12px] text-ds-text-2">10초 동안 늘어난 무게</div>
            <div className="num text-[34px]">{delta == null ? '--' : `${delta.toFixed(1)} g`}</div>
            <div className="text-[14px] text-ds-text-2">
              → {delta == null ? '--' : `${(delta / 10).toFixed(2)} mL/s`} (물 1g = 1mL)
            </div>
          </Cell>
          {delta != null && delta <= 0 ? (
            <p className="mt-3 text-center">
              <StatusLabel status="warn" text="무게가 늘지 않았어요. 출수구 위치·튜브를 확인하고 다시 재 보세요" />
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2.5">
            <GhostButton onClick={() => setStep(0)}>다시 재기</GhostButton>
            <LimeButton
              disabled={!online || !!r.busy || delta == null || delta <= 0}
              onClick={() => delta != null && void r.run(`flow 10000 ${delta.toFixed(1)}`, () => setStep(2))}
            >
              저장
            </LimeButton>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <p className="text-center">
            <StatusLabel
              status="ok"
              text={`저장했어요 · ${isNum(mlps) ? mlps.toFixed(2) : '--'} mL/s. 이제 mL 단위로 급수할 수 있어요`}
            />
          </p>
          <div className="mt-4">
            <LimeButton to={`/water/${id}`}>급수 화면으로</LimeButton>
          </div>
        </>
      ) : null}
      <RunState busy={r.busy} error={r.error} />
    </>
  )
}

// ------------------------------------------------------------ 지금 저장된 보정값

function Saved({ node }: { node: NodeState | undefined }) {
  const i = node?.info
  const rows: [string, string][] = [
    ['토양 A 공기 · 물', i?.soil_a_cal === 1 ? `${i.soil_a_air} · ${i.soil_a_wet} mV` : '보정 전'],
    [
      '토양 B 공기 · 물',
      i?.soil_b_cal === 1
        ? `${i.soil_b_air} · ${i.soil_b_wet} mV`
        : node?.sensors.soil_b.present
          ? '보정 전'
          : '미설치',
    ],
    [
      '로드셀 영점 · 배율',
      i?.lc_cal === 1 && isNum(i.lc_offset) && isNum(i.lc_scale)
        ? `${i.lc_offset} · ${i.lc_scale}`
        : node?.sensors.scale.present
          ? '보정 전'
          : '미설치',
    ],
    [
      '펌프 유량',
      isNum(i?.pump_mlps) && i.pump_mlps > 0
        ? `${i.pump_mlps.toFixed(2)} mL/s`
        : node?.sensors.pump.present
          ? '보정 전'
          : '미설치',
    ],
  ]
  return (
    <Panel aria-label="지금 저장된 보정값">
      <PanelHeader title="지금 저장된 보정값" />
      <dl className="divide-y divide-white/10">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2.5 text-[13.5px]">
            <dt className="text-ds-text-2">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11.5px] text-ds-text-3">보정값은 ESP32 안에 저장돼 전원을 꺼도 남아요.</p>
    </Panel>
  )
}

export default function CalibratePage() {
  const { node: param, kind } = useParams()
  const id = (param ?? 'Z1').toUpperCase()
  const node = useNode(id)
  if (!kind || !KINDS.some((k) => k.kind === kind)) return <Navigate to={`/calibrate/${id}/soil`} replace />
  const k = kind as Kind
  return (
    <>
      <ZoneTitle id={id} sub="보정" subTo={`/zone/${id}`} />
      <PillTabs
        className="mt-5 lg:max-w-[560px]"
        items={KINDS.map((x) => ({ to: `/calibrate/${id}/${x.kind}`, label: x.label, active: x.kind === k }))}
      />
      <div className="mt-3 lg:grid lg:grid-cols-[1.2fr_1fr] lg:gap-4">
        <Panel aria-label="보정 단계">
          {!node?.online ? (
            <p className="mb-3">
              <StatusLabel status="offline" text="구역이 연결돼 있지 않아 지금은 보정할 수 없어요" />
            </p>
          ) : null}
          {k === 'soil' ? <SoilWizard key={id} id={id} node={node} /> : null}
          {k === 'scale' ? <ScaleWizard key={id} id={id} node={node} /> : null}
          {k === 'flow' ? <FlowWizard key={id} id={id} node={node} /> : null}
        </Panel>
        <div className="mt-2.5 lg:mt-0">
          <Saved node={node} />
        </div>
      </div>
    </>
  )
}
