import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, ChevronRight, Clock, Droplet, GlassWater, Scale, Square } from 'lucide-react'
import {
  CornerPlant,
  GhostButton,
  HoldButton,
  LimeButton,
  Panel,
  PanelHeader,
  RangeBar,
  StatusLabel,
} from '@/components/ds/ui'
import { zoneIds, zoneProfile } from '@/config/zones'
import { useNode } from '@/hooks/useNode'
import { useNow } from '@/hooks/useNow'
import { reasonText, sendCommand } from '@/lib/commands'
import { hm, kstDay } from '@/lib/history'
import { parseTs } from '@/lib/nodeState'
import { waterPrecheck } from '@/lib/precheck'
import { clamp01, fmt, isNum, values } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToasts'
import type { NodeId, NodeState, Severity } from '@/types/api'

const AMOUNTS = [10, 20, 30, 40, 50] // 1회 최대 50mL (펌웨어 MAX_ML_PER_SHOT)

function nodeStatus(node: NodeState | undefined): { status: Severity; text: string } {
  if (!node?.last_seen) return { status: 'offline', text: '신호 없음' }
  if (!node.online) return { status: 'offline', text: '끊김' }
  const t = { ok: '정상', info: '정상', warn: '주의', fault: '고장', offline: '끊김' }[node.status]
  return { status: node.status === 'info' ? 'ok' : node.status, text: t }
}

/** 화분 카드 (디자인 06 목록, 09 완료 화면 위쪽) */
function ZoneCard({
  id,
  selected,
  onClick,
  to,
}: {
  id: NodeId
  selected?: boolean
  onClick?: () => void
  to?: string
}) {
  const node = useNode(id)
  const p = zoneProfile(id)
  const v = values(node?.latest)
  const s = nodeStatus(node)
  const body = (
    <>
      <span className="w-[38%] shrink-0 self-stretch overflow-hidden rounded-[18px]">
        {p.photo ? <img src={p.photo} alt="" className="size-full object-cover" /> : null}
      </span>
      <span className="min-w-0 flex-1 py-1">
        <span className="flex items-center justify-between">
          <span className="text-[20px] font-semibold">
            {id} <span className="ml-1.5 text-[15px] font-normal">{p.name}</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.5} aria-hidden />
        </span>
        <StatusLabel status={s.status} text={s.text} className="mt-1.5 text-[12px] text-white" />
        <span className="mt-2 grid grid-cols-4 gap-1 border-t border-white/10 pt-2 text-[11px] text-ds-text-2">
          <span>토양수분</span>
          <span>온도</span>
          <span>습도</span>
          <span>무게</span>
          <span className="num text-[13.5px] whitespace-nowrap text-white">{fmt.soil(v.soil)}</span>
          <span className="num text-[13.5px] whitespace-nowrap text-white">
            {v.temp == null ? '--' : `${v.temp.toFixed(1)}℃`}
          </span>
          <span className="num text-[13.5px] whitespace-nowrap text-white">{fmt.rh(v.rh)}</span>
          <span className="num text-[13.5px] whitespace-nowrap text-white">
            {fmt.grams(v.weightG)}
            {v.weightG == null ? '' : ' g'}
          </span>
        </span>
      </span>
    </>
  )
  const cls = cn(
    'flex w-full gap-3.5 rounded-[22px] border bg-[var(--ds-panel)] p-2 pr-4 text-left backdrop-blur-md transition-colors',
    selected
      ? 'border-[#c7e88f]/80 bg-[#3a4630]/60 shadow-[0_0_0_1px_rgba(199,232,143,.25)]'
      : 'border-[var(--ds-panel-line)]',
  )
  if (to) {
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cls}>
      {body}
    </button>
  )
}

// ------------------------------------------------------------ 06 화분 고르기

function WaterSelect() {
  const navigate = useNavigate()
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const ids = zoneIds(seen)
  const firstOnline = useAppStore((s) => ids.find((id) => s.nodes[id]?.online))
  const [picked, setPicked] = useState<NodeId | null>(null)
  const active = picked ?? firstOnline ?? ids[0]
  return (
    <div className="relative">
      <CornerPlant
        src="/design/leaves-top.jpg"
        className="-top-[64px] -right-4 h-[300px] w-[62%] opacity-80 lg:right-0"
      />
      <div className="relative mt-7 pl-2">
        <div className="text-[13px] tracking-[0.1em] text-ds-text-3">PLANT SELECT</div>
        <h1 className="mt-2 text-[32px] leading-[1.25] font-semibold">
          물을 줄 화분을
          <br />
          선택해주세요.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ds-text-2">
          각 화분의 상태를 확인하고
          <br />
          급수를 시작할 수 있어요.
        </p>
      </div>
      <div className="relative mt-6 grid gap-3 lg:grid-cols-3">
        {ids.map((id) => (
          <ZoneCard key={id} id={id} selected={id === active} onClick={() => setPicked(id)} />
        ))}
      </div>
      <div className="mx-auto mt-6 lg:max-w-[420px]">
        <LimeButton onClick={() => navigate(`/water/${active}`)}>
          {active} 선택하기 <ArrowRight size={20} strokeWidth={1.8} aria-hidden />
        </LimeButton>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 07 급수 제어

function ControlView({
  id,
  node,
  ml,
  setMl,
  onStart,
  starting,
}: {
  id: NodeId
  node: NodeState | undefined
  ml: number
  setMl: (v: number) => void
  onStart: () => void
  starting: boolean
}) {
  const p = zoneProfile(id)
  const v = values(node?.latest)
  const pre = waterPrecheck(node, ml)
  const fails = pre.checks.filter((c) => !c.ok)
  return (
    <div className="relative lg:grid lg:grid-cols-2 lg:gap-10">
      <div className="relative min-h-[430px]">
        {p.hero ? (
          <img
            src={p.hero}
            alt=""
            aria-hidden
            className="pointer-events-none absolute top-0 -right-4 h-[430px] w-[78%] object-cover lg:right-0"
            style={{
              maskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 48%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 48%, transparent 100%)',
              filter: 'brightness(.82) saturate(.95)',
            }}
          />
        ) : null}
        <div className="relative pt-6 pl-2" style={{ textShadow: 'var(--ds-shadow-text)' }}>
          <h1 className="text-[42px] leading-[1.05] font-normal tracking-[-0.02em]">
            {id}
            <br />
            {p.name}
          </h1>
          <div className="mt-2 text-[14px] text-ds-text-2">급수 제어</div>
          <dl className="mt-6 w-[112px] space-y-4">
            <div>
              <dt className="text-[12px] text-ds-text-2">토양수분</dt>
              <dd className="num text-[26px] leading-tight">{fmt.soil(v.soil)}</dd>
              <RangeBar frac={v.soil == null ? null : clamp01(v.soil)} className="mt-1.5" />
              <div className="mt-1 flex justify-between text-[10px] text-ds-text-3">
                <span>0</span>
                <span>1</span>
              </div>
            </div>
            <div className="border-t border-white/10 pt-3">
              <dt className="text-[12px] text-ds-text-2">온도</dt>
              <dd className="num text-[24px] leading-tight">
                {v.temp == null ? '--' : v.temp.toFixed(1)}
                {v.temp == null ? null : <span className="text-[15px]">℃</span>}
              </dd>
            </div>
            <div className="border-t border-white/10 pt-3">
              <dt className="text-[12px] text-ds-text-2">습도</dt>
              <dd className="num text-[24px] leading-tight">{fmt.rh(v.rh)}</dd>
            </div>
            <div className="border-t border-white/10 pt-3">
              <dt className="text-[12px] text-ds-text-2">무게</dt>
              <dd className="num text-[24px] leading-tight">
                {fmt.grams(v.weightG)}
                {v.weightG == null ? null : <span className="ml-1 text-[15px]">g</span>}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="relative mt-3 space-y-3 lg:mt-24">
        <section
          aria-label="오늘 급수량"
          className="flex items-center justify-between gap-3 rounded-[24px] border border-white/25 bg-white/[0.12] px-6 py-5 backdrop-blur-xl"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ds-text-2">오늘 급수량</div>
            <div className="num mt-0.5 text-[24px] leading-tight font-light">
              <span className="font-semibold">{Math.round(pre.today)}</span> / {pre.limit} mL
            </div>
            <div className="mt-2.5 h-[5px] max-w-[220px] rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-[var(--ds-lime)]"
                style={{ width: `${clamp01(pre.today / pre.limit) * 100}%` }}
              />
            </div>
          </div>
          <div className="shrink-0 rounded-[16px] border border-white/15 bg-white/[0.08] px-3.5 py-2.5 text-right">
            <div className="text-[12px] text-ds-text-2">하루 한도</div>
            <div className="num text-[16px]">{pre.limit} mL</div>
          </div>
        </section>
        <Panel aria-label="급수량 선택">
          <div className="text-[14px] text-ds-text-2">급수량 선택 (mL)</div>
          <div className="mt-3 grid grid-cols-5 gap-2" role="radiogroup" aria-label="급수량">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={ml === a}
                onClick={() => setMl(a)}
                className={cn(
                  'num h-[48px] rounded-[14px] border text-[16px]',
                  ml === a
                    ? 'border-transparent bg-[var(--ds-btn-lime)] font-semibold text-[var(--ds-btn-lime-ink)]'
                    : 'border-white/15 bg-white/[0.06]',
                )}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[12.5px]" aria-live="polite">
            {fails.length ? (
              <ul className="space-y-1">
                {fails.map((c) => (
                  <li key={c.key}>
                    <StatusLabel status="warn" text={c.why} className="text-[12.5px]" />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-ds-text-2">
                켜기 전 점검 통과 · 약 {pre.seconds?.toFixed(1)}초 ({pre.mlps.toFixed(2)} mL/s)
              </span>
            )}
          </div>
        </Panel>
        <HoldButton onHold={onStart} disabled={!pre.ok || starting} hint={starting ? '보내는 중…' : '1초 길게 누르기'}>
          <Droplet size={20} strokeWidth={2} fill="currentColor" aria-hidden />
          급수 시작하기
        </HoldButton>
        <p className="text-center text-[11px] text-ds-text-3">
          최종 확인은 ESP32가 합니다 · 하드웨어 비상정지 스위치가 이 화면보다 항상 우선입니다
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 08 급수 중

function WaterLog({ id }: { id: NodeId }) {
  const list = useAppStore(
    useShallow((s) =>
      s.events.filter((e) => e.node === id && e.kind === 'evt' && e.payload.ev === 'pump_off').slice(0, 4),
    ),
  )
  return (
    <Panel aria-label="최근 급수 기록">
      <PanelHeader title="최근 급수 기록" to={`/history/${id}`} more="전체 보기" />
      {list.length === 0 ? (
        <p className="py-3 text-center text-[13px] text-ds-text-3">아직 급수 기록이 없어요</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((e, i) => {
            const at = parseTs(e.time)
            const ml = e.payload.ml
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.06] px-3 py-2 text-[13.5px]">
                <Droplet size={16} strokeWidth={1.5} className={i === 0 ? 'fill-white/60' : ''} aria-hidden />
                <span className="num w-[96px]">{kstDay(at).replace(/-/g, '. ')}</span>
                <span className="num flex-1 text-ds-text-2">{hm(at)}</span>
                <span className="num">
                  {typeof ml === 'number' ? `${fmt.ml(ml)} mL` : reasonText(String(e.payload.reason ?? ''))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function RunningView({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const now = useNow()
  const p = zoneProfile(id)
  const pump = node?.pump
  const start = parseTs(pump?.started_at)
  const dur = pump?.dur ?? 0
  const k = dur > 0 && Number.isFinite(start) ? clamp01((now - start) / dur) : 0
  const ml = pump?.ml ?? null
  const left = dur > 0 ? Math.max(0, Math.ceil((start + dur - now) / 1000)) : null
  const R = 120
  const C = 2 * Math.PI * R
  const angle = k * 2 * Math.PI - Math.PI / 2
  const stop = async () => {
    const r = await sendCommand(id, 'stop')
    if (r.ok) toast.ok('급수를 멈췄어요')
    else toast.error('정지가 확인되지 않았어요', r.message)
  }
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-10">
      <div>
        <div className="mt-6">
          <h1 className="text-[26px] font-semibold">
            {id} <span className="ml-1">{p.name}</span>
          </h1>
          <p className="mt-1 text-[14px] text-ds-text-2">급수가 진행되고 있어요.</p>
        </div>
        <div className="relative mx-auto mt-6 size-[280px]" role="img" aria-label={`급수 ${Math.round(k * 100)}% 진행`}>
          <svg viewBox="0 0 280 280" className="absolute inset-0">
            <circle cx="140" cy="140" r="136" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.12)" />
            <circle cx="140" cy="140" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="14" />
            <circle
              cx="140"
              cy="140"
              r={R}
              fill="none"
              stroke="var(--ds-lime)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${k * C} ${C}`}
              transform="rotate(-90 140 140)"
            />
            <circle cx={140 + R * Math.cos(angle)} cy={140 + R * Math.sin(angle)} r="11" fill="#fff" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Droplet size={30} strokeWidth={1.4} className="fill-white/70 text-white/80" aria-hidden />
            {ml != null ? (
              <>
                <div className="num mt-1 text-[58px] leading-none font-semibold">
                  {Math.round(ml * k)}
                  <span className="ml-1 text-[26px] font-normal">mL</span>
                </div>
                <div className="num mt-1 text-[18px] text-ds-text-2">/ {fmt.ml(ml)} mL</div>
              </>
            ) : (
              <div className="num mt-1 text-[48px] leading-none font-semibold">{Math.round(k * 100)}%</div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-center">
          <GhostButton onClick={stop} className="w-[240px]">
            <Square size={14} fill="currentColor" aria-hidden />
            급수 중지하기
          </GhostButton>
        </div>
      </div>
      <div className="mt-6 space-y-3 lg:mt-24">
        <div className="grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 py-4">
          <div className="flex items-center gap-2 px-2">
            <span className="text-[13px]">펌프 작동 중</span>
            <span className="size-[11px] rounded-full bg-[var(--ds-chart)]" aria-hidden />
          </div>
          <div className="flex items-center gap-2 px-3">
            <Clock size={24} strokeWidth={1.3} aria-hidden />
            <div>
              <div className="text-[11px] text-ds-text-2">남은 시간</div>
              <div className="num text-[18px]">{left == null ? '--' : `${left} 초`}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3">
            <GlassWater size={24} strokeWidth={1.3} aria-hidden />
            <div>
              <div className="text-[11px] text-ds-text-2">물통 잔량</div>
              <div className="text-[13px] text-ds-text-3">센서 없음</div>
            </div>
          </div>
        </div>
        <WaterLog id={id} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 09 급수 완료

type Session = { ml: number | null; beforeG: number | null; beforeAt: string | null }

function DoneView({
  id,
  node,
  session,
  onAgain,
}: {
  id: NodeId
  node: NodeState | undefined
  session: Session
  onAgain: () => void
}) {
  const off = useAppStore((s) => s.parts[id]?.pumpOff ?? null)
  const on = useAppStore((s) => s.parts[id]?.pumpOn ?? null)
  const result = useAppStore((s) => s.lastWater[id])
  const reason = String(off?.payload.reason ?? 'done')
  const ok = reason === 'done'
  const requested = session.ml ?? (typeof on?.payload.ml === 'number' ? on.payload.ml : null)
  const actual = typeof off?.payload.ml === 'number' ? off.payload.ml : null
  const scale = node?.sensors.scale.present ?? false
  // 급수 전 무게: 펌프가 켜지기 직전 측정값 (다른 기기에서 시작한 급수도), 없으면 이 화면에서 시작할 때 값
  const recent = useAppStore((s) => s.recent[id])
  const onAt = on ? parseTs(on.created_at) : null
  const beforeMsg =
    onAt == null
      ? undefined
      : [...(recent ?? [])].reverse().find((d) => parseTs(d.created_at) < onAt && isNum(d.weight_g))
  const beforeG = beforeMsg && isNum(beforeMsg.weight_g) ? beforeMsg.weight_g : session.beforeG
  const beforeAt = beforeMsg?.created_at ?? session.beforeAt
  const after =
    node?.latest && off && parseTs(node.latest.created_at) > parseTs(off.created_at) + 2000 ? node.latest : null
  const afterG = after && isNum(after.weight_g) ? after.weight_g : null
  const delta = afterG != null && beforeG != null ? afterG - beforeG : null
  const offAt = off ? parseTs(off.created_at) : null
  return (
    <div className="relative">
      <CornerPlant
        src="/design/leaves-top.jpg"
        className="-top-[64px] -right-4 h-[300px] w-[60%] opacity-85 lg:right-0"
      />
      <div className="relative lg:grid lg:grid-cols-2 lg:gap-10">
        <div>
          <div className="mt-7 pl-2 text-[13px] tracking-[0.1em] text-ds-text-3">
            {ok ? 'WATERING COMPLETE' : 'WATERING STOPPED'}
          </div>
          <h1 className="mt-2 text-[36px] leading-[1.2] font-semibold">
            급수가
            <br />
            {ok ? '완료되었어요.' : '멈췄어요.'}
          </h1>
          <p className="mt-3 text-[14px] text-ds-text-2">
            {ok ? '펌프가 정해진 시간만큼 돌았어요.' : reasonText(reason) || '펌프가 중간에 멈췄어요.'}
          </p>
          <div className="mt-6">
            <ZoneCard id={id} to={`/zone/${id}`} selected />
          </div>
        </div>
        <div className="mt-3 space-y-3 lg:mt-24">
          <Panel aria-label="급수 결과" className="p-0">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <h2 className="text-[16px] font-semibold">급수 결과</h2>
              <span className="num text-[12.5px] text-ds-text-2">
                {offAt ? `${kstDay(offAt).replace(/-/g, '. ')}  ${hm(offAt)}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/10">
              <div className="flex items-center gap-3 px-5 py-4">
                <Droplet size={30} strokeWidth={1.2} className="fill-white/40" aria-hidden />
                <div>
                  <div className="text-[12px] text-ds-text-2">요청 급수량</div>
                  <div className="num text-[19px] whitespace-nowrap">
                    {requested == null ? '--' : `${fmt.ml(requested)} mL`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-4">
                <Droplet size={30} strokeWidth={1.2} className="fill-white/40" aria-hidden />
                <div>
                  <div className="text-[12px] text-ds-text-2">실제 급수량</div>
                  <div className="num text-[19px] whitespace-nowrap">
                    {actual == null ? '--' : `${fmt.ml(actual)} mL`}
                    {actual != null && requested != null && Math.abs(actual - requested) >= 0.05 ? (
                      <span className="ml-1 text-[11px] text-ds-text-3">
                        ({actual - requested > 0 ? '+' : ''}
                        {(actual - requested).toFixed(1)})
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-ds-text-3">펌프가 돈 시간으로 계산</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10">
              <div className="flex items-center gap-3 px-5 py-4">
                <Scale size={30} strokeWidth={1.2} className="text-[var(--ds-chart)]" aria-hidden />
                <div>
                  <div className="text-[12px] text-ds-text-2">무게 변화</div>
                  <div className="num text-[19px] whitespace-nowrap">
                    {!scale ? '--' : delta == null ? '재는 중…' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} g`}
                  </div>
                  {!scale ? <div className="text-[10.5px] text-ds-text-3">무게 센서 미설치</div> : null}
                </div>
              </div>
              <div className="px-5 py-4">
                {result && result.verdict ? (
                  <>
                    <StatusLabel
                      status={result.verdict === 'ok' ? 'ok' : 'warn'}
                      text={result.verdict === 'ok' ? '정상' : '확인 필요'}
                    />
                    <p className="mt-1 text-[12px] text-ds-text-2">진단 서버의 급수 결과예요.</p>
                  </>
                ) : (
                  <>
                    <StatusLabel status={ok ? 'ok' : 'warn'} text={ok ? '끝까지 급수함' : '중간에 멈춤'} />
                    <p className="mt-1 text-[12px] text-ds-text-2">
                      {scale
                        ? '물이 들어갔는지는 무게 변화로 확인하세요.'
                        : '무게 센서를 달면 실제로 들어간 양도 확인할 수 있어요.'}
                    </p>
                  </>
                )}
              </div>
            </div>
          </Panel>
          <Panel aria-label="급수 전후 비교" className="p-0">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <h2 className="text-[16px] font-semibold">급수 전후 비교</h2>
              <span className="text-[12px] text-ds-text-2">단위: g (보정값)</span>
            </div>
            {scale ? (
              <div className="flex items-center justify-around px-5 py-4 text-center">
                <div>
                  <div className="text-[12.5px] text-[var(--ds-chart)]">급수 전</div>
                  <div className="num text-[24px]">{beforeG == null ? '--' : `${beforeG.toFixed(1)} g`}</div>
                  <div className="num text-[11.5px] text-ds-text-3">{beforeAt ? hm(parseTs(beforeAt)) : ''}</div>
                </div>
                <ArrowRight size={26} strokeWidth={1.4} className="text-[var(--ds-chart)]" aria-hidden />
                <div>
                  <div className="text-[12.5px] text-[var(--ds-chart)]">급수 후</div>
                  <div className="num text-[24px]">{afterG == null ? '--' : `${afterG.toFixed(1)} g`}</div>
                  <div className="num text-[11.5px] text-ds-text-3">
                    {after ? hm(parseTs(after.created_at)) : '재는 중…'}
                  </div>
                </div>
              </div>
            ) : (
              <p className="px-5 py-5 text-center text-[13px] text-ds-text-3">무게 센서가 없어 비교할 수 없어요</p>
            )}
          </Panel>
          <div className="grid grid-cols-[1fr_1.4fr] gap-3">
            <GhostButton to="/">홈으로</GhostButton>
            <LimeButton onClick={onAgain} className="h-[56px]">
              <Droplet size={18} strokeWidth={2} fill="currentColor" aria-hidden />
              다시 급수하기
            </LimeButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 한 구역 급수: 제어 → 진행 → 완료

function WaterZone({ id }: { id: NodeId }) {
  const node = useNode(id)
  const [ml, setMl] = useState(30)
  const [phase, setPhase] = useState<'control' | 'starting' | 'running' | 'done'>(node?.pump.on ? 'running' : 'control')
  const [session, setSession] = useState<Session>({ ml: null, beforeG: null, beforeAt: null })
  const pumpOn = !!node?.pump.on

  // 실제 펌프 상태로 화면을 바꾼다: 켜지면 진행, 진행 중에 꺼지면 완료 (값이 바뀔 때 렌더 중에 맞춘다)
  const [prevPumpOn, setPrevPumpOn] = useState(pumpOn)
  if (pumpOn !== prevPumpOn) {
    setPrevPumpOn(pumpOn)
    setPhase((p) => (pumpOn && p !== 'running' ? 'running' : !pumpOn && p === 'running' ? 'done' : p))
  }

  const start = async () => {
    setPhase('starting')
    setSession({
      ml,
      beforeG: isNum(node?.latest?.weight_g) ? node.latest.weight_g : null,
      beforeAt: node?.latest?.created_at ?? null,
    })
    const r = await sendCommand(id, `water ${ml}`)
    if (!r.ok) {
      toast.error('급수를 시작하지 못했어요', r.message)
      setPhase('control')
      return
    }
    setPhase((p) => (p === 'starting' ? 'running' : p)) // 펌프 켜짐 사건이 곧 따라온다
  }

  if (phase === 'running') return <RunningView id={id} node={node} />
  if (phase === 'done') return <DoneView id={id} node={node} session={session} onAgain={() => setPhase('control')} />
  return (
    <ControlView
      id={id}
      node={node}
      ml={ml}
      setMl={setMl}
      onStart={() => void start()}
      starting={phase === 'starting'}
    />
  )
}

export default function WaterPage() {
  const { node } = useParams()
  const id = useMemo(() => node?.toUpperCase(), [node])
  return id ? <WaterZone key={id} id={id} /> : <WaterSelect />
}
