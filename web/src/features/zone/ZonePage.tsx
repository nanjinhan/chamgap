import { useMemo, type ComponentType } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  ChartNoAxesColumn,
  ChevronRight,
  Droplet,
  Leaf,
  Power,
  Settings,
  ShoppingBag,
  Square,
  StickyNote,
  Thermometer,
  type LucideProps,
} from 'lucide-react'
import { Sparkline } from '@/components/ds/charts'
import { CornerPlant, Panel, PanelHeader, RangeBar, ZonePills, ZoneTitle } from '@/components/ds/ui'
import { zoneProfile } from '@/config/zones'
import { useFreshness, useNode } from '@/hooks/useNode'
import { toActivity, type Activity } from '@/lib/activity'
import { clamp01, fmt, isNum, kindState, values } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { NodeId } from '@/types/api'

/** 지표 카드 (디자인 02: 아이콘 · 이름 · 값 · 범위 막대 · >) */
function MetricCard({
  to,
  icon: Icon,
  label,
  value,
  unit,
  frac,
  min,
  max,
  note,
  dim,
}: {
  to: string
  icon: ComponentType<LucideProps>
  label: string
  value: string
  unit?: string
  frac: number | null
  min: string
  max: string
  note?: string
  dim: boolean
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-[18px] border border-[var(--ds-panel-line)] bg-[var(--ds-panel)] px-3 py-2.5 backdrop-blur-md"
    >
      <Icon size={26} strokeWidth={1.3} className="shrink-0 text-white/90" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-[11.5px] text-ds-text-2">
          {label}
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        </div>
        <div className={cn('num text-[22px] leading-[1.15] font-normal whitespace-nowrap', dim && 'opacity-55')}>
          {value}
          {unit ? <span className="ml-1 text-[16px]">{unit}</span> : null}
        </div>
        {note ? (
          <div className="mt-1 text-[10.5px] text-ds-text-3">{note}</div>
        ) : (
          <div className="mt-1 flex items-center gap-2 text-[9.5px] text-ds-text-3">
            <span>{min}</span>
            <RangeBar frac={frac} className="flex-1" />
            <span>{max}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

const ACT_ICON: Record<Activity['icon'], ComponentType<LucideProps>> = {
  drop: Droplet,
  gear: Settings,
  chart: ChartNoAxesColumn,
  power: Power,
  note: StickyNote,
  stop: Square,
}

/** 최근 활동 (디자인 02: 왼쪽 시간 줄 + 오른쪽 카드) */
function RecentActivity({ id }: { id: NodeId }) {
  const events = useAppStore(useShallow((s) => s.events.filter((e) => e.node === id).slice(0, 12)))
  const list = useMemo(
    () =>
      events
        .map(toActivity)
        .filter((a): a is Activity => a !== null)
        .slice(0, 3),
    [events],
  )
  return (
    <Panel aria-label="최근 활동">
      <PanelHeader title="최근 활동" to={`/history/${id}`} more="전체 보기" />
      {list.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ds-text-3">아직 기록된 활동이 없어요</p>
      ) : (
        <ol className="relative">
          <span aria-hidden className="absolute top-3 bottom-3 left-[5px] w-px bg-white/25" />
          {list.map((a) => {
            const Icon = ACT_ICON[a.icon]
            return (
              <li key={a.id} className="relative flex items-center gap-3 py-1">
                <span
                  aria-hidden
                  className="relative z-10 size-[11px] shrink-0 rounded-full border-2 border-white bg-[#cfd4cf]"
                />
                <span className="num w-[38px] shrink-0 text-[11.5px] text-ds-text-2">{a.time}</span>
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.07] px-3 py-1.5">
                  <Icon size={19} strokeWidth={1.4} className="shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{a.title}</div>
                    {a.desc ? <div className="truncate text-[10.5px] text-ds-text-3">{a.desc}</div> : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

/** A / B 비교 (디자인 02): 토양 수분 A·B 지금 값 + 최근 흐름 */
function ABCompare({ id }: { id: NodeId }) {
  const node = useNode(id)
  const recent = useAppStore((s) => s.recent[id])
  const data = useMemo(() => (recent ?? []).map((d) => ({ a: d.soil_a, b: d.soil_b })), [recent])
  const cells = [
    {
      key: 'a',
      label: 'A 센서',
      v: node?.latest?.soil_a,
      present: node?.sensors.soil_a.present ?? true,
      color: 'var(--ds-chart)',
      bar: 'bg-[var(--ds-chart)]',
    },
    {
      key: 'b',
      label: 'B 센서',
      v: node?.latest?.soil_b,
      present: node?.sensors.soil_b.present ?? true,
      color: '#f2f2ee',
      bar: 'bg-white/80',
    },
  ]
  return (
    <Panel aria-label="A / B 비교">
      <PanelHeader title="A / B 비교" to={`/zone/${id}/sensor/soil`} />
      <div className="grid grid-cols-2 gap-2.5">
        {cells.map((c) => (
          <div
            key={c.key}
            className="flex items-stretch gap-2 rounded-[14px] border border-white/[0.06] bg-[var(--ds-panel-2)] px-2.5 py-2"
          >
            <span aria-hidden className={cn('my-1 w-[3px] shrink-0 rounded-full', c.bar)} />
            <div className="shrink-0">
              <div className="text-[11px] text-ds-text-2">{c.label}</div>
              <div className="num text-[20px] leading-tight">
                {c.present ? fmt.soil(isNum(c.v) ? c.v : null) : '--'}
              </div>
            </div>
            <div className="min-w-0 flex-1 self-end">
              {c.present ? (
                data.length > 1 ? (
                  <Sparkline data={data} k={c.key} color={c.color} height={30} />
                ) : null
              ) : (
                <div className="text-right text-[10.5px] text-ds-text-3">미설치</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** 아래 바로가기 4개 (디자인 02) */
function Shortcuts({ id }: { id: NodeId }) {
  const items = [
    { to: `/zone/${id}/sensor/climate`, label: '온습도 상세', icon: Thermometer },
    { to: `/zone/${id}/sensor/soil`, label: '토양 상세', icon: Leaf },
    { to: `/zone/${id}/sensor/weight`, label: '무게 상세', icon: ShoppingBag },
    { to: `/history/${id}`, label: '기록 보기', icon: ChartNoAxesColumn },
  ]
  return (
    <nav aria-label="바로가기" className="grid grid-cols-4 gap-2">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex flex-col items-center gap-1.5 rounded-[16px] border border-[var(--ds-panel-line)] bg-[var(--ds-panel)] px-1 py-2.5 backdrop-blur-md"
        >
          <Icon size={22} strokeWidth={1.3} aria-hidden />
          <span className="inline-flex items-center text-[11.5px] whitespace-nowrap">
            {label}
            <ChevronRight size={13} strokeWidth={1.5} aria-hidden />
          </span>
        </Link>
      ))}
    </nav>
  )
}

export default function ZonePage() {
  const { node: param } = useParams()
  const id = (param ?? 'Z1').toUpperCase()
  const node = useNode(id)
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const { ago, stale } = useFreshness(node?.last_seen)
  const p = zoneProfile(id)
  const v = values(node?.latest)
  const dim = stale || !node?.online
  const climate = kindState(node, 'climate')
  const soil = kindState(node, 'soil')
  const weight = kindState(node, 'weight')
  const sub = !node?.last_seen
    ? '아직 신호가 없어요'
    : node.online
      ? `${p.nameKo} · ${ago} 갱신`
      : `${p.nameKo} · 연결 끊김 (${ago})`

  return (
    <div className="relative lg:grid lg:grid-cols-2 lg:gap-10">
      <div className="relative">
        <CornerPlant
          src={p.hero}
          className="-top-[64px] -right-4 h-[280px] w-[64%] lg:-top-[40px] lg:right-0 lg:h-[380px] lg:w-[58%]"
        />
        <div className="relative">
          <ZoneTitle id={id} sub={sub} />
          <ZonePills active={id} seen={seen} to={(z) => `/zone/${z}`} className="mt-6" />
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <MetricCard
            to={`/zone/${id}/sensor/climate`}
            icon={Thermometer}
            label="온도"
            value={fmt.temp(v.temp)}
            frac={v.temp == null ? null : clamp01((v.temp - 10) / 30)}
            min="10°"
            max="40°"
            note={climate.present ? undefined : '미설치'}
            dim={dim}
          />
          <MetricCard
            to={`/zone/${id}/sensor/climate`}
            icon={Droplet}
            label="습도"
            value={fmt.rh(v.rh)}
            frac={v.rh == null ? null : clamp01(v.rh / 100)}
            min="0%"
            max="100%"
            note={climate.present ? undefined : '미설치'}
            dim={dim}
          />
          <MetricCard
            to={`/zone/${id}/sensor/soil`}
            icon={Leaf}
            label="토양 수분"
            value={fmt.soil(v.soil)}
            frac={v.soil == null ? null : clamp01(v.soil)}
            min="0"
            max="1"
            note={!soil.present ? '미설치' : soil.status === 'info' ? '보정 전' : undefined}
            dim={dim}
          />
          <MetricCard
            to={`/zone/${id}/sensor/weight`}
            icon={ShoppingBag}
            label="무게"
            value={fmt.grams(v.weightG)}
            unit={v.weightG == null ? undefined : 'g'}
            frac={v.weightG == null ? null : clamp01(v.weightG / 3000)}
            min="0"
            max="3,000"
            note={weight.present ? undefined : '미설치'}
            dim={dim}
          />
        </div>
      </div>
      <div className="mt-2 space-y-2 lg:mt-[118px]">
        <ABCompare id={id} />
        <RecentActivity id={id} />
        <Shortcuts id={id} />
      </div>
    </div>
  )
}
