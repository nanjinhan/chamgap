import { useId } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/**
 * 새 디자인 그래프 (디자인 02~04): 어두운 판 위 연두 선 + 아래로 옅어지는 채움, 점선 세로 격자,
 * 누른 곳에 세로선과 유리 말풍선. A 센서는 연두, B 센서는 흰색.
 */

const AXIS = { fill: 'rgba(255,255,255,.62)', fontSize: 11 }

export type Series = { key: string; name: string; color: string; fill?: boolean }

function Tip({
  active,
  payload,
  label,
  fmtX,
  fmtY,
}: {
  active?: boolean
  payload?: readonly { value?: unknown; name?: unknown; dataKey?: unknown }[]
  label?: unknown
  fmtX: (v: number | string) => string
  fmtY: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const items = payload.filter((p) => typeof p.value === 'number')
  if (!items.length) return null
  return (
    <div className="rounded-[10px] border border-white/20 bg-[#5d6662]/90 px-3 py-1.5 text-center shadow-lg backdrop-blur">
      <div className="text-[11px] text-white/75">{fmtX(label as number | string)}</div>
      {items.map((p) => (
        <div key={String(p.dataKey)} className="num text-[16px] leading-tight text-white">
          {items.length > 1 ? <span className="mr-1 text-[11px] text-white/70">{String(p.name)}</span> : null}
          {fmtY(p.value as number)}
        </div>
      ))}
    </div>
  )
}

/** 선 + 채움 그래프 */
export function TrendChart({
  data,
  series,
  xKey,
  xDomain,
  xTicks,
  fmtX,
  yDomain,
  yTicks,
  fmtY,
  fmtTick,
  height = 180,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey: string
  xDomain?: [number, number]
  xTicks?: (number | string)[]
  fmtX: (v: number | string) => string
  yDomain: [number, number]
  yTicks: number[]
  fmtY: (v: number) => string
  fmtTick?: (v: number) => string
  height?: number
}) {
  const gid = useId().replace(/:/g, '')
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.38} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical horizontal={false} stroke="rgba(255,255,255,.12)" strokeDasharray="3 4" />
          <XAxis
            dataKey={xKey}
            type={xDomain ? 'number' : 'category'}
            domain={xDomain}
            ticks={xTicks}
            tickFormatter={(v) => fmtX(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,.25)' }}
            interval={0}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={(v: number) => (fmtTick ?? fmtY)(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDataOverflow
          />
          <Tooltip
            cursor={{ stroke: '#fff', strokeWidth: 1.5 }}
            content={(p) => <Tip {...p} fmtX={fmtX} fmtY={fmtY} />}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={s.fill === false ? 'transparent' : `url(#${gid}-${s.key})`}
              dot={data.length <= 40 ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false} // 점이 많으면 선만
              activeDot={{ r: 6, fill: s.color, stroke: '#fff', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 막대 그래프 (A·B 나란히, 또는 하나) */
export function BarsChart({
  data,
  series,
  xKey,
  yDomain,
  yTicks,
  fmtY,
  fmtTick,
  height = 150,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey: string
  yDomain: [number, number]
  yTicks: number[]
  fmtY: (v: number) => string
  fmtTick?: (v: number) => string
  height?: number
}) {
  const gid = useId().replace(/:/g, '')
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={4}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.75} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical stroke="rgba(255,255,255,.12)" strokeDasharray="3 4" />
          <XAxis
            dataKey={xKey}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,.25)' }}
            interval={0}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={(v: number) => (fmtTick ?? fmtY)(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDataOverflow
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,.06)' }}
            content={(p) => <Tip {...p} fmtX={(v) => String(v)} fmtY={fmtY} />}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={`url(#${gid}-${s.key})`}
              radius={[6, 6, 2, 2]}
              maxBarSize={series.length > 1 ? 13 : 26}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 작은 흐름 그래프 (디자인 02 A/B 비교 칸 안) */
export function Sparkline({
  data,
  k,
  color,
  height = 46,
}: {
  data: Record<string, unknown>[]
  k: string
  color: string
  height?: number
}) {
  const gid = useId().replace(/:/g, '')
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin - 0.02', 'dataMax + 0.02']} />
          <Area
            type="monotone"
            dataKey={k}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gid})`}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 기록이 없을 때 그래프 자리 */
export function ChartEmpty({ height = 150, text = '아직 기록이 없어요' }: { height?: number; text?: string }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-[14px] border border-dashed border-white/15 text-[13px] text-ds-text-3"
    >
      {text}
    </div>
  )
}
