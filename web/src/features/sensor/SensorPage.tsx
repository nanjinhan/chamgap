import { useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronRight, CircleHelp, Droplet } from 'lucide-react'
import { BarsChart, ChartEmpty, TrendChart } from '@/components/ds/charts'
import { Cell, Panel, PanelHeader, PillTabs, StatusLabel, ZoneTitle } from '@/components/ds/ui'
import { zoneProfile } from '@/config/zones'
import { useNode } from '@/hooks/useNode'
import { useNow } from '@/hooks/useNow'
import { dailyAvg, hm, kstDay, kstMidnight, md, stats, useHistory, withAvg } from '@/lib/history'
import { avgAB, clamp01, fmt, isNum, kindState, sensorState, type Kind } from '@/lib/readings'
import { cn } from '@/lib/utils'
import type { NodeId, NodeState } from '@/types/api'

const KINDS: { kind: Kind; label: string; sub: string }[] = [
  { kind: 'climate', label: '온습도', sub: '온습도 센서' },
  { kind: 'soil', label: '토양수분', sub: '토양수분 센서' },
  { kind: 'weight', label: '무게', sub: '무게 센서' },
]
// 예전 주소(/sensor/sht_a 등)도 받는다
const LEGACY: Record<string, Kind> = {
  sht_a: 'climate',
  sht_b: 'climate',
  soil_a: 'soil',
  soil_b: 'soil',
  scale: 'weight',
}
const DAY = 86_400_000

/** 날짜 고르기 알약 (오늘부터 14일 전까지, 기록 보관 기간) */
function DatePill({ day, onDay }: { day: string; onDay: (d: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const now = useNow()
  return (
    <label className="relative inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 text-[12.5px]">
      <CalendarDays size={15} strokeWidth={1.5} aria-hidden />
      <span className="num">{day.replace(/-/g, '. ')}</span>
      <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
      <input
        ref={ref}
        type="date"
        aria-label="날짜 고르기"
        value={day}
        min={kstDay(now - 13 * DAY)}
        max={kstDay(now)}
        onChange={(e) => e.target.value && onDay(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  )
}

function StatRow({ items }: { items: { label: string; value: string; sub: string }[] }) {
  return (
    <div className="mt-3 grid grid-cols-3 divide-x divide-white/15 rounded-[16px] border border-white/[0.06] bg-[var(--ds-panel-2)] py-3">
      {items.map((it) => (
        <div key={it.label} className="px-3.5">
          <div className="text-[11.5px] text-ds-text-2">{it.label}</div>
          <div className="num text-[22px] leading-tight">{it.value}</div>
          <div className="num text-[11px] text-ds-text-3">{it.sub}</div>
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <span className="inline-flex items-center gap-3 text-[12px] text-ds-text-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[9px] rounded-full bg-[var(--ds-chart)]" />A 센서
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[9px] rounded-full bg-white" />B 센서
      </span>
    </span>
  )
}

// ------------------------------------------------------------ 온습도 (디자인 03)

function ClimateView({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const now = useNow()
  const [metric, setMetric] = useState<'temp' | 'rh'>('temp')
  const [day, setDay] = useState(() => kstDay(now))
  const swipe = useRef<number | null>(null)
  const isTemp = metric === 'temp'
  const name = isTemp ? '온도' : '습도'
  const a = isTemp ? node?.latest?.temp_a : node?.latest?.rh_a
  const b = isTemp ? node?.latest?.temp_b : node?.latest?.rh_b
  const f = isTemp ? fmt.temp : fmt.rh
  const big = avgAB(a, b)
  const state = kindState(node, 'climate')
  const sa = sensorState(node, 'sht_a')
  const sb = sensorState(node, 'sht_b')

  // 고른 날 0시부터 지금까지를 15분 평균으로 받아 그 날만 남긴다 (오늘이면 10분)
  const start = kstMidnight(Date.parse(`${day}T12:00:00+09:00`))
  const today = day === kstDay(now)
  const { rows } = useHistory(id, (now - start) / 60_000 + 1, today ? 600 : 900)
  const keyA = isTemp ? 'temp_a' : 'rh_a'
  const keyB = isTemp ? 'temp_b' : 'rh_b'
  const data = useMemo(
    () =>
      withAvg(
        (rows ?? []).filter((r) => r.t >= start && r.t < start + DAY),
        keyA,
        keyB,
        'avg',
      ),
    [rows, start, keyA, keyB],
  )
  const st = stats(data, 'avg')
  const yDomain: [number, number] = isTemp ? [10, 35] : [0, 100]
  const yTicks = isTemp ? [10, 15, 20, 25, 30, 35] : [0, 20, 40, 60, 80, 100]
  const xTicks = [0, 4, 8, 12, 16, 20, 24].map((h) => start + h * 3_600_000)
  const fmtY = (v: number) => (isTemp ? `${v.toFixed(1)}°` : `${Math.round(v)}%`)
  const fmtTick = (v: number) => (isTemp ? `${v}°` : `${v}%`)
  const fmtX = (v: number | string) => (typeof v === 'number' ? (v >= start + DAY ? '24:00' : hm(v)) : String(v))

  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-4">
      <div className="space-y-2.5">
        <Panel aria-label={`현재 ${name}`} className="touch-pan-y" as="section">
          <div
            onPointerDown={(e) => (swipe.current = e.clientX)}
            onPointerUp={(e) => {
              if (swipe.current != null && Math.abs(e.clientX - swipe.current) > 40) setMetric(isTemp ? 'rh' : 'temp')
              swipe.current = null
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold">현재 {name}</h2>
                <span className="flex gap-1" role="tablist" aria-label="온도·습도">
                  {(['temp', 'rh'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={metric === m}
                      aria-label={m === 'temp' ? '온도' : '습도'}
                      onClick={() => setMetric(m)}
                      className={cn('size-[9px] rounded-full', metric === m ? 'bg-[var(--ds-chart)]' : 'bg-white/35')}
                    />
                  ))}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMetric(isTemp ? 'rh' : 'temp')}
                className="text-[11px] text-ds-text-2"
              >
                ← 좌우로 스와이프하여 {isTemp ? '습도' : '온도'}를 확인하세요 →
              </button>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <div className="num text-[54px] leading-none font-normal tracking-[-0.03em] whitespace-nowrap">
                  {f(big)}
                </div>
                <StatusLabel status={state.status} text={state.text} className="mt-2" />
              </div>
              <div className="flex gap-2">
                {[
                  { label: 'A 센서', v: a, s: sa },
                  { label: 'B 센서', v: b, s: sb },
                ].map((c) => (
                  <Cell key={c.label} className="w-[86px] px-2.5 py-2.5">
                    <div className="text-[12px] text-ds-text-2">{c.label}</div>
                    <div className="num mt-0.5 text-[22px] leading-tight whitespace-nowrap">
                      {c.s.present ? f(isNum(c.v) ? c.v : null) : '--'}
                    </div>
                    <StatusLabel status={c.s.status} text={c.s.text} className="mt-1 text-[11.5px]" />
                  </Cell>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>
      <div className="mt-2.5 space-y-2.5 lg:mt-0">
        <Panel aria-label={`${md(day)} ${name} 변화`}>
          <PanelHeader
            title={`${today ? '오늘' : md(day)}의 ${name} 변화`}
            right={<DatePill day={day} onDay={setDay} />}
          />
          {data.some((r) => isNum(r.avg)) ? (
            <TrendChart
              data={data}
              series={[{ key: 'avg', name, color: 'var(--ds-chart)' }]}
              xKey="t"
              xDomain={[start, start + DAY]}
              xTicks={xTicks}
              fmtX={fmtX}
              yDomain={yDomain}
              yTicks={yTicks}
              fmtY={fmtY}
              fmtTick={fmtTick}
            />
          ) : (
            <ChartEmpty height={180} text={state.present ? '이 날 기록이 없어요' : '온습도 센서 미설치'} />
          )}
          <StatRow
            items={[
              { label: '최저', value: st ? fmtY(st.min.v) : '--', sub: st ? hm(st.min.t) : '' },
              { label: '최고', value: st ? fmtY(st.max.v) : '--', sub: st ? hm(st.max.t) : '' },
              { label: '평균', value: st ? fmtY(st.avg) : '--', sub: today ? '≈ 오늘' : md(day) },
            ]}
          />
        </Panel>
        <Panel aria-label={`A / B ${name} 비교`}>
          <PanelHeader title={`A / B ${name} 비교`} right={<Legend />} />
          {data.some((r) => isNum(r[keyA]) || isNum(r[keyB])) ? (
            <TrendChart
              data={data}
              series={[
                { key: keyA, name: 'A', color: 'var(--ds-chart)' },
                { key: keyB, name: 'B', color: '#f2f2ee', fill: false },
              ]}
              xKey="t"
              xDomain={[start, start + DAY]}
              xTicks={xTicks}
              fmtX={fmtX}
              yDomain={yDomain}
              yTicks={yTicks}
              fmtY={fmtY}
              fmtTick={fmtTick}
              height={160}
            />
          ) : (
            <ChartEmpty height={160} text={state.present ? '이 날 기록이 없어요' : '온습도 센서 미설치'} />
          )}
        </Panel>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 토양수분 (디자인 04)

/** 세로 캡슐 게이지 (위는 빗금, 아래는 연두로 차오름) */
function Capsule({ frac, className }: { frac: number | null; className?: string }) {
  return (
    <div
      className={cn('relative w-[44px] overflow-hidden rounded-full border border-white/25', className)}
      style={{ background: 'repeating-linear-gradient(135deg, rgba(255,255,255,.14) 0 2px, transparent 2px 6px)' }}
      role="img"
      aria-label={frac == null ? '값 없음' : `${Math.round(frac * 100)}%`}
    >
      {frac != null ? (
        <div
          className="absolute inset-x-0 bottom-0 rounded-b-full bg-gradient-to-b from-[#c5ea8c] to-[#9fd062]"
          style={{ height: `${clamp01(frac) * 100}%` }}
        />
      ) : null}
    </div>
  )
}

function soilMessage(node: NodeState | undefined): string {
  const s = kindState(node, 'soil')
  if (!node?.last_seen) return '아직 신호가 없어요.'
  if (!s.present) return '토양 센서가 아직 연결되지 않았어요.'
  if (s.status === 'offline') return '연결이 끊겨 마지막 값을 보여 주고 있어요.'
  if (s.status === 'fault') return '토양 센서 값을 읽지 못하고 있어요.'
  if (s.status === 'info') return '토양 센서 보정이 필요해요.'
  return '토양 센서 값이 잘 들어오고 있어요.'
}

function SoilView({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const now = useNow()
  const p = zoneProfile(id)
  const { rows } = useHistory(id, 7 * 1440, 3600, 300_000)
  const days = useMemo(() => dailyAvg(rows ?? [], ['soil_a', 'soil_b'], 7, now), [rows, now])
  const info = node?.info
  const cells = [
    {
      key: 'a',
      label: 'A 센서',
      v: node?.latest?.soil_a,
      s: sensorState(node, 'soil_a'),
      mv: node?.latest?.soil_a_mv,
      air: info?.soil_a_air,
      wet: info?.soil_a_wet,
    },
    {
      key: 'b',
      label: 'B 센서',
      v: node?.latest?.soil_b,
      s: sensorState(node, 'soil_b'),
      mv: node?.latest?.soil_b_mv,
      air: info?.soil_b_air,
      wet: info?.soil_b_wet,
    },
  ]
  const cal = [info?.soil_a_cal, info?.soil_b_cal]
  const calText = cal.every((c) => c === 1) ? '보정됨' : cal.some((c) => c === 1) ? '일부만 보정됨' : '보정 전'
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-4">
      <div className="space-y-2.5">
        <section
          aria-label="토양 상태"
          className="relative h-[150px] overflow-hidden rounded-[22px] border border-white/15"
        >
          <img
            src="/design/soil-banner.jpg"
            alt=""
            className="absolute inset-y-0 right-0 h-full w-[62%] object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#2e3b2f] via-[#2e3b2f]/85 to-transparent" />
          <div className="relative flex h-full flex-col justify-center px-6">
            <div className="text-[28px] font-semibold">{p.name}</div>
            <p className="mt-1 text-[14px] text-white/85">{soilMessage(node)}</p>
          </div>
        </section>
        <Panel aria-label="현재 토양수분">
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                현재 토양수분{' '}
                <CircleHelp size={16} strokeWidth={1.5} className="text-white/60" aria-label="0은 공기 중, 1은 물 속" />
              </span>
            }
            right={<span className="text-[12px] text-ds-text-2">단위: 0 ~ 1 (정규화 값)</span>}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {cells.map((c) => (
              <Cell key={c.key} className="flex items-stretch gap-1.5 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ds-text-2">
                    {c.label} <StatusLabel status={c.s.status} text={c.s.text} className="text-[12px]" />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Droplet size={20} strokeWidth={1.5} aria-hidden />
                    <span className="num text-[25px] leading-none font-semibold whitespace-nowrap">
                      {c.s.present ? fmt.soil(isNum(c.v) ? c.v : null) : '--'}
                    </span>
                  </div>
                  <div className="mt-3 text-[11.5px] leading-snug text-ds-text-3">
                    적정 범위
                    <br />({p.soilRange[0].toFixed(2)} ~ {p.soilRange[1].toFixed(2)})
                  </div>
                </div>
                <Capsule frac={c.s.present && isNum(c.v) ? c.v : null} className="h-[108px] w-[34px] shrink-0" />
              </Cell>
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-2.5 space-y-2.5 lg:mt-0">
        <Panel aria-label="최근 7일 토양수분 변화">
          <PanelHeader title="최근 7일 토양수분 변화" right={<Legend />} />
          {days.some((d) => isNum(d.soil_a) || isNum(d.soil_b)) ? (
            <BarsChart
              data={days}
              series={[
                { key: 'soil_a', name: 'A', color: '#b6dc76' },
                { key: 'soil_b', name: 'B', color: '#f2f2ee' },
              ]}
              xKey="label"
              yDomain={[0, 1]}
              yTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
              fmtY={(v) => v.toFixed(2)}
              fmtTick={(v) => v.toFixed(1)}
            />
          ) : (
            <ChartEmpty />
          )}
        </Panel>
        <Panel aria-label="센서 상세 정보">
          <PanelHeader title="센서 상세 정보" to={`/calibrate/${id}/soil`} more="보정하기" />
          <div className="grid grid-cols-3 divide-x divide-white/15">
            {cells.map((c) => (
              <div key={c.key} className="px-3 first:pl-0">
                <div className="text-[12px] text-ds-text-2">{c.label} (mV)</div>
                <div className="num text-[24px] leading-tight">{c.s.present && isNum(c.mv) ? c.mv : '--'}</div>
                <div className="text-[10.5px] text-ds-text-3">
                  {c.s.present && isNum(c.air) && isNum(c.wet)
                    ? `공기 ${c.air} · 물 ${c.wet}`
                    : c.s.present
                      ? ''
                      : '미설치'}
                </div>
              </div>
            ))}
            <div className="px-3">
              <div className="text-[12px] text-ds-text-2">보정 상태</div>
              <div className="text-[20px] leading-tight">{calText}</div>
              <StatusLabel
                status={calText === '보정됨' ? 'ok' : 'info'}
                text={calText === '보정됨' ? '공기·물 값 저장됨' : '보정하기에서'}
                className="text-[10.5px]"
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ 무게 (디자인 05)

function WeightView({ id, node }: { id: NodeId; node: NodeState | undefined }) {
  const now = useNow()
  const p = zoneProfile(id)
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('day')
  const { rows } = useHistory(id, 14 * 1440, 3600, 300_000)
  const daily14 = useMemo(() => dailyAvg(rows ?? [], ['weight_g'], 14, now), [rows, now])
  const daily7 = daily14.slice(7)
  const kg = (g: unknown) => (isNum(g) ? g / 1000 : null)
  const line = daily7.map((d) => ({ label: d.label, day: d.day, kg: kg(d.weight_g) }))
  const st = stats(
    line.map((d, i) => ({ ...d, t: i })),
    'kg',
  )
  const bars =
    mode === 'day'
      ? line
      : mode === 'week'
        ? [daily14.slice(0, 7), daily14.slice(7)].map((w, i) => {
            const xs = w.map((d) => kg(d.weight_g)).filter(isNum)
            return {
              label: i ? '이번 주' : '지난 주',
              kg: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null,
            }
          })
        : [
            {
              label: `${kstDay(now).slice(5, 7)}월`,
              kg: (() => {
                const xs = daily14.map((d) => kg(d.weight_g)).filter(isNum)
                return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
              })(),
            },
          ]
  const w = kg(node?.latest?.weight_g)
  const state = kindState(node, 'weight')
  const [lo, hi] = p.weightRangeKg
  const span = hi - lo
  const gaugeMin = Math.max(0, lo - span * 0.25)
  const gaugeMax = hi + span * 0.25
  const yDomain: [number, number] = [Math.floor(gaugeMin * 2) / 2, Math.ceil(gaugeMax * 2) / 2]
  const yTicks: number[] = []
  for (let t = yDomain[0]; t <= yDomain[1] + 1e-9; t += 0.5) yTicks.push(Number(t.toFixed(1)))
  const range = `${daily7[0]?.day.replace(/-/g, '. ') ?? ''} ~ ${md(daily7.at(-1)?.day ?? kstDay(now))}`

  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-4">
      <div className="space-y-2.5">
        <Panel aria-label="현재 무게">
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                현재 무게{' '}
                <CircleHelp size={16} strokeWidth={1.5} className="text-white/60" aria-label="화분 전체 무게" />
              </span>
            }
            right={<span className="text-[12px] text-ds-text-2">단위: kg (보정값)</span>}
          />
          <div className="flex items-center gap-3">
            <img
              src="/design/weight-pot.jpg"
              alt=""
              className="h-[124px] w-[92px] shrink-0 rounded-[14px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="num text-[42px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap">
                {state.present ? fmt.kg(node?.latest?.weight_g ?? null) : '--'}
                <span className="ml-1.5 text-[22px] font-normal text-ds-text-2">kg</span>
              </div>
              <StatusLabel status={state.status} text={state.text} className="mt-2" />
              <div className="mt-1 text-[12.5px] text-ds-text-3">
                적정 범위 ({lo} ~ {hi})
              </div>
            </div>
            <div className="relative flex h-[124px] shrink-0 items-stretch gap-1.5">
              <Capsule frac={w == null ? null : (w - gaugeMin) / (gaugeMax - gaugeMin)} className="w-[26px]" />
              <div className="num flex flex-col justify-between py-2 text-[12px] text-ds-text-2">
                <span>{hi}</span>
                {w != null ? (
                  <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-white">
                    {w.toFixed(2)}
                  </span>
                ) : null}
                <span>{lo}</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>
      <div className="mt-2.5 space-y-2.5 lg:mt-0">
        <Panel aria-label="최근 7일 무게 변화">
          <PanelHeader
            title="최근 7일 무게 변화"
            right={
              <span className="inline-flex h-[34px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 text-[12px]">
                <CalendarDays size={15} strokeWidth={1.5} aria-hidden />
                <span className="num">{range}</span>
              </span>
            }
          />
          {line.some((d) => isNum(d.kg)) ? (
            <TrendChart
              data={line}
              series={[{ key: 'kg', name: '무게', color: 'var(--ds-chart)' }]}
              xKey="label"
              fmtX={(v) => String(v)}
              yDomain={yDomain}
              yTicks={yTicks}
              fmtY={(v) => `${v.toFixed(2)} kg`}
              fmtTick={(v) => v.toFixed(1)}
              height={150}
            />
          ) : (
            <ChartEmpty text={state.present ? '아직 기록이 없어요' : '무게 센서 미설치'} />
          )}
          <StatRow
            items={[
              { label: '최저', value: st ? `${st.min.v.toFixed(2)} kg` : '--', sub: st ? line[st.min.t].label : '' },
              { label: '최고', value: st ? `${st.max.v.toFixed(2)} kg` : '--', sub: st ? line[st.max.t].label : '' },
              { label: '평균', value: st ? `${st.avg.toFixed(2)} kg` : '--', sub: '∼ 최근 7일' },
            ]}
          />
        </Panel>
        <Panel aria-label="일별 무게 변화">
          <PanelHeader
            title="일별 무게 변화"
            right={
              <span
                className="inline-flex rounded-full border border-white/15 bg-white/[0.06] p-0.5 text-[12.5px]"
                role="tablist"
              >
                {(
                  [
                    ['day', '일'],
                    ['week', '주'],
                    ['month', '월'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={mode === k}
                    onClick={() => setMode(k)}
                    className={cn(
                      'rounded-full px-3.5 py-1',
                      mode === k ? 'bg-[var(--ds-green)] font-semibold' : 'text-white/75',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </span>
            }
          />
          {bars.some((d) => isNum(d.kg)) ? (
            <BarsChart
              data={bars}
              series={[{ key: 'kg', name: '무게', color: '#b6dc76' }]}
              xKey="label"
              yDomain={yDomain}
              yTicks={yTicks}
              fmtY={(v) => `${v.toFixed(2)} kg`}
              fmtTick={(v) => v.toFixed(1)}
            />
          ) : (
            <ChartEmpty text={state.present ? '아직 기록이 없어요' : '무게 센서 미설치'} />
          )}
          {mode !== 'day' ? <p className="mt-2 text-[11px] text-ds-text-3">기록은 14일만 보관해요.</p> : null}
        </Panel>
      </div>
    </div>
  )
}

export default function SensorPage() {
  const { node: param, sensor } = useParams()
  const id = (param ?? 'Z1').toUpperCase()
  const node = useNode(id)
  const kind: Kind | null = !sensor
    ? null
    : KINDS.some((k) => k.kind === sensor)
      ? (sensor as Kind)
      : (LEGACY[sensor] ?? null)
  if (!kind) return <Navigate to={`/zone/${id}/sensor/climate`} replace />
  if (sensor !== kind) return <Navigate to={`/zone/${id}/sensor/${kind}`} replace />
  const meta = KINDS.find((k) => k.kind === kind)!
  return (
    <>
      <ZoneTitle id={id} sub={meta.sub} subTo={`/zone/${id}`} />
      <PillTabs
        className="mt-5 lg:max-w-[560px]"
        items={KINDS.map((k) => ({ to: `/zone/${id}/sensor/${k.kind}`, label: k.label, active: k.kind === kind }))}
      />
      <div className="mt-3">
        {kind === 'climate' ? <ClimateView id={id} node={node} /> : null}
        {kind === 'soil' ? <SoilView id={id} node={node} /> : null}
        {kind === 'weight' ? <WeightView id={id} node={node} /> : null}
      </div>
      <p className="mt-4 text-center text-[11.5px] text-ds-text-3">
        <Link to={`/zone/${id}`} className="inline-flex items-center gap-0.5">
          {id} 구역 상세로 <ChevronRight size={13} strokeWidth={1.5} />
        </Link>
      </p>
    </>
  )
}
