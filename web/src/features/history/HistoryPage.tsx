import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  ChartNoAxesColumn,
  Download,
  Droplet,
  Power,
  Settings,
  Square,
  StickyNote,
  type LucideProps,
} from 'lucide-react'
import { ChartEmpty, TrendChart } from '@/components/ds/charts'
import { Panel, PanelHeader, ZonePills, ZoneTitle } from '@/components/ds/ui'
import { useNow } from '@/hooks/useNow'
import { toActivity, type Activity } from '@/lib/activity'
import { hm, kstDay, md, useHistory, type HistRow } from '@/lib/history'
import { isNum } from '@/lib/readings'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toLiveEvent, useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToasts'
import type { EventRow, Metric, NodeId } from '@/types/api'

/**
 * 기록 (요구사항 W9·CLD-05·CLD-06): 기간·지표를 골라 A/B 그래프, 그 기간의 사건, 메모, CSV 내보내기.
 * 그래프는 Supabase history() 평균, CSV는 6시간 이하면 원래 측정값·더 길면 같은 평균값.
 */

const PERIODS = [
  { key: '1h', label: '1시간', minutes: 60, bucket: 60 },
  { key: '6h', label: '6시간', minutes: 360, bucket: 300 },
  { key: '24h', label: '24시간', minutes: 1440, bucket: 900 },
  { key: '7d', label: '7일', minutes: 10_080, bucket: 3600 },
] as const

type MetricDef = {
  key: string
  label: string
  a: Metric
  b: Metric | null
  fmt: (v: number) => string
  delta: (v: number) => string
}
const METRICS: MetricDef[] = [
  {
    key: 'soil',
    label: '토양 수분',
    a: 'soil_a',
    b: 'soil_b',
    fmt: (v) => v.toFixed(2),
    delta: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
  },
  {
    key: 'temp',
    label: '온도',
    a: 'temp_a',
    b: 'temp_b',
    fmt: (v) => `${v.toFixed(1)}°`,
    delta: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°C`,
  },
  {
    key: 'rh',
    label: '습도',
    a: 'rh_a',
    b: 'rh_b',
    fmt: (v) => `${Math.round(v)}%`,
    delta: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
  },
  {
    key: 'weight',
    label: '무게',
    a: 'weight_g',
    b: null,
    fmt: (v) => `${Math.round(v).toLocaleString('en-US')} g`,
    delta: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} g`,
  },
]

/** 보기 좋은 눈금 (5개 안팎) */
function niceScale(lo: number, hi: number): { domain: [number, number]; ticks: number[] } {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const raw = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const d0 = Math.floor(lo / step) * step
  const d1 = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = d0; t <= d1 + step / 2; t += step) ticks.push(Number(t.toFixed(6)))
  return { domain: [d0, d1], ticks }
}

const KST = 9 * 3_600_000
const stamp = (ms: number) => new Date(ms + KST).toISOString().slice(0, 19).replace('T', ' ')

const CSV_COLS: [string, string][] = [
  ['temp_a', '온도 A(°C)'],
  ['temp_b', '온도 B(°C)'],
  ['rh_a', '습도 A(%)'],
  ['rh_b', '습도 B(%)'],
  ['soil_a', '토양 A(0~1)'],
  ['soil_b', '토양 B(0~1)'],
  ['soil_a_mv', '토양 A(mV)'],
  ['soil_b_mv', '토양 B(mV)'],
  ['weight_g', '무게(g)'],
  ['weight_sd', '무게 흔들림(g)'],
  ['v12', '12V(V)'],
]

/** CSV 내보내기 (엑셀용 BOM, 한글 머리글, CLD-06) */
async function exportCsv(id: NodeId, period: (typeof PERIODS)[number], now: number, hist: HistRow[]) {
  if (!supabase) return
  let rows: { t: number; [k: string]: unknown }[]
  let kind: string
  if (period.minutes <= 360) {
    const since = new Date(now - period.minutes * 60_000).toISOString()
    const cols = ['created_at', ...CSV_COLS.map(([k]) => k)].join(',')
    const all: Record<string, unknown>[] = []
    for (let from = 0; from < 6000; from += 1000) {
      const { data, error } = await supabase
        .from('readings')
        .select(cols)
        .eq('node', id)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, from + 999)
      if (error) {
        toast.error('CSV를 만들지 못했어요', error.message)
        return
      }
      all.push(...((data ?? []) as unknown as Record<string, unknown>[]))
      if (!data || data.length < 1000) break
    }
    rows = all.map((r) => ({ ...r, t: Date.parse(String(r.created_at)) }))
    kind = '측정값'
  } else {
    rows = hist
    kind = `${period.bucket / 60}분평균`
  }
  const esc = (v: unknown) => (v == null ? '' : String(v))
  const lines = [['시각(한국)', ...CSV_COLS.map(([, h]) => h)].join(',')]
  for (const r of rows) lines.push([stamp(r.t), ...CSV_COLS.map(([k]) => esc(r[k]))].join(','))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chamgap_${id}_${kstDay(now)}_${period.label}_${kind}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.ok('CSV를 내려받았어요', `${rows.length}줄 · ${kind}`)
}

const ICON: Record<Activity['icon'], ComponentType<LucideProps>> = {
  drop: Droplet,
  gear: Settings,
  chart: ChartNoAxesColumn,
  power: Power,
  note: StickyNote,
  stop: Square,
}

/** 이 기간의 사건 + 메모 남기기 */
function EventsPanel({ id, minutes, now }: { id: NodeId; minutes: number; now: number }) {
  const [rows, setRows] = useState<EventRow[] | null>(null)
  const [note, setNote] = useState('')
  const [tick, setTick] = useState(0)
  const live = useAppStore(useShallow((s) => s.events.filter((e) => e.node === id).length))
  const since = useMemo(() => new Date(now - minutes * 60_000).toISOString(), [now, minutes])
  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase
      .from('events')
      .select('*')
      .eq('node', id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<EventRow[]>()
      .then(({ data }) => alive && setRows(data ?? []))
    return () => {
      alive = false
    }
    // 새 사건이 들어오거나(live) 메모를 남기면(tick) 다시 읽는다. since 는 분이 바뀔 때만 바뀐다
  }, [id, since, live, tick])
  const list = (rows ?? [])
    .map(toLiveEvent)
    .map((e) => (e ? toActivity(e) : null))
    .filter((a): a is Activity => a !== null)

  const save = async () => {
    const text = note.trim()
    if (!text || !supabase) return
    const { error } = await supabase.from('events').insert({ node: id, t: 'mark', payload: { note: text } })
    if (error) toast.error('메모를 남기지 못했어요', error.message)
    else {
      setNote('')
      setTick((t) => t + 1)
      toast.ok('메모를 남겼어요')
    }
  }

  return (
    <Panel aria-label="사건">
      <PanelHeader title="사건 · 메모" />
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="메모 (예: 토양 센서 위치를 옮김)"
          aria-label="메모"
          className="h-[42px] min-w-0 flex-1 rounded-[12px] border border-white/15 bg-white/[0.06] px-3 text-[14px] text-white placeholder:text-white/40 outline-none focus:border-[var(--ds-lime)]"
        />
        <button
          type="submit"
          disabled={!note.trim()}
          className="h-[42px] shrink-0 rounded-[12px] bg-[var(--ds-btn-lime)] px-4 text-[14px] font-semibold text-[var(--ds-btn-lime-ink)] disabled:opacity-40"
        >
          + 메모
        </button>
      </form>
      {rows == null ? (
        <p className="py-4 text-center text-[13px] text-ds-text-3">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ds-text-3">이 기간에 사건이 없어요</p>
      ) : (
        <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
          {list.map((a) => {
            const Icon = ICON[a.icon]
            return (
              <li key={a.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.06] px-3 py-2">
                <Icon size={18} strokeWidth={1.4} className="shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.title}</div>
                  {a.desc ? <div className="truncate text-[11px] text-ds-text-3">{a.desc}</div> : null}
                </div>
                <span className="num shrink-0 text-right text-[11px] text-ds-text-2">
                  {md(a.day)}
                  <br />
                  {a.time}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

export default function HistoryPage() {
  const { node: param } = useParams()
  const id = (param ?? 'Z1').toUpperCase()
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const now = useNow()
  const minuteNow = Math.floor(now / 60_000) * 60_000 // 그래프·사건 범위는 분 단위로만 움직인다
  const [pk, setPk] = useState<(typeof PERIODS)[number]['key']>('6h')
  const [mk, setMk] = useState('soil')
  const period = PERIODS.find((p) => p.key === pk)!
  const metric = METRICS.find((m) => m.key === mk)!
  const { rows } = useHistory(id, period.minutes, period.bucket)
  const data = rows ?? []
  const keys = [metric.a, metric.b].filter((k): k is Metric => k != null)
  const vals = data.flatMap((r) => keys.map((k) => r[k])).filter(isNum)
  const scale = vals.length ? niceScale(Math.min(...vals), Math.max(...vals)) : null
  const start = minuteNow - period.minutes * 60_000
  const xTicks = Array.from({ length: 5 }, (_, i) => start + ((minuteNow - start) * i) / 4)
  const fmtX = (v: number | string) =>
    typeof v === 'number' ? (period.minutes > 1440 ? md(kstDay(v)) : hm(v)) : String(v)
  const firstA = data.find((r) => isNum(r[metric.a]))?.[metric.a]
  const lastA = [...data].reverse().find((r) => isNum(r[metric.a]))?.[metric.a]
  const summary =
    isNum(firstA) && isNum(lastA)
      ? `${period.label} 동안 ${metric.delta(lastA - firstA)}${metric.b ? ' (A 센서)' : ''}`
      : null

  return (
    <>
      <ZoneTitle id={id} sub="기록" subTo={`/zone/${id}`} />
      <ZonePills active={id} seen={seen} to={(z) => `/history/${z}`} className="mt-5" />
      <div className="mt-3 lg:grid lg:grid-cols-[1.5fr_1fr] lg:gap-4">
        <Panel aria-label="그래프">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5" role="radiogroup" aria-label="기간">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={pk === p.key}
                  onClick={() => setPk(p.key)}
                  className={cn(
                    'h-[32px] rounded-full px-3 text-[12.5px]',
                    pk === p.key ? 'bg-[var(--ds-green)] font-semibold' : 'border border-white/15 bg-white/[0.06]',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void exportCsv(id, period, now, data)}
              className="inline-flex h-[32px] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[12.5px]"
            >
              <Download size={14} strokeWidth={1.6} aria-hidden />
              CSV
            </button>
          </div>
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="지표">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mk === m.key}
                onClick={() => setMk(m.key)}
                className={cn(
                  'h-[32px] shrink-0 rounded-full px-3 text-[12.5px]',
                  mk === m.key ? 'bg-white text-[#1d2320] font-semibold' : 'border border-white/15 bg-white/[0.06]',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">{metric.label}</h2>
            {metric.b ? (
              <span className="inline-flex items-center gap-3 text-[12px] text-ds-text-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-[9px] rounded-full bg-[var(--ds-chart)]" />A 센서
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-[9px] rounded-full bg-white" />B 센서
                </span>
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            {scale ? (
              <TrendChart
                data={data}
                series={[
                  { key: metric.a, name: 'A', color: 'var(--ds-chart)' },
                  ...(metric.b ? [{ key: metric.b, name: 'B', color: '#f2f2ee', fill: false }] : []),
                ]}
                xKey="t"
                xDomain={[start, minuteNow]}
                xTicks={xTicks}
                fmtX={fmtX}
                yDomain={scale.domain}
                yTicks={scale.ticks}
                fmtY={metric.fmt}
                fmtTick={(v) =>
                  Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(2)))
                }
                height={220}
              />
            ) : (
              <ChartEmpty height={220} text={rows == null ? '불러오는 중…' : '이 기간에 기록이 없어요'} />
            )}
          </div>
          <p className="mt-2 text-[13px] text-ds-text-2">{summary ?? ' '}</p>
          <p className="mt-1 text-[11px] text-ds-text-3">
            {period.bucket / 60}분 평균 · 기록은 14일 보관 · CSV는{' '}
            {period.minutes <= 360 ? '원래 측정값' : `${period.bucket / 60}분 평균`}
          </p>
        </Panel>
        <div className="mt-2.5 lg:mt-0">
          <EventsPanel id={id} minutes={period.minutes} now={minuteNow} />
        </div>
      </div>
    </>
  )
}
