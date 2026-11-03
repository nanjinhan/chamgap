import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { zoneIds, zoneProfile } from '@/config/zones'
import { useFreshness, useNode } from '@/hooks/useNode'
import { kindState, values } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToasts'
import type { NodeId, NodeState } from '@/types/api'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

type Metric = {
  label: string
  value: string
  unit?: string
  frac: number | null // 막대 채움 0~1
  min: string
  max: string
  note?: string // '미설치', '보정 전'
}

/** 사진 위 측정값 하나 (디자인 01: 이름 · 큰 숫자 · 범위 막대 · 양 끝 값) */
function MetricBlock({ m, dim, className }: { m: Metric; dim: boolean; className: string }) {
  return (
    <div className={cn('absolute w-[25%] min-w-[88px]', className)} style={{ textShadow: 'var(--ds-shadow-text)' }}>
      <div className="text-[11.5px] text-ds-text-2">{m.label}</div>
      <div className={cn('num mt-0.5 text-[29px] leading-[1.1] font-light tracking-[-0.01em]', dim && 'opacity-55')}>
        {m.value}
        {m.unit ? <span className="ml-0.5 text-[20px]">{m.unit}</span> : null}
      </div>
      <div className="mt-[7px] h-[3px] w-[56px] rounded-full bg-[var(--ds-track)]">
        {m.frac != null ? (
          <div className="h-full rounded-full bg-[var(--ds-lime-soft)]" style={{ width: `${m.frac * 100}%` }} />
        ) : null}
      </div>
      {/* 양 끝 값 자리: '미설치'·'보정 전'이면 그 말을 대신 쓴다 (오른쪽 열이 좁아서) */}
      <div className="mt-[5px] flex w-[56px] justify-between text-[9px] text-ds-text-3">
        {m.note ? (
          <span className="whitespace-nowrap">{m.note}</span>
        ) : (
          <>
            <span>{m.min}</span>
            <span>{m.max}</span>
          </>
        )}
      </div>
    </div>
  )
}

function metrics(node: NodeState | undefined): Record<'temp' | 'rh' | 'soil' | 'weight', Metric> {
  const { temp, rh, soil, weightG: w } = values(node?.latest)
  const soilState = kindState(node, 'soil')
  return {
    temp: {
      label: '온도',
      value: temp == null ? '--' : `${temp.toFixed(1)}°`,
      frac: temp == null ? null : clamp01((temp - 10) / 30),
      min: '10°',
      max: '40°',
      note: node && !kindState(node, 'climate').present ? '미설치' : undefined,
    },
    rh: {
      label: '습도',
      value: rh == null ? '--' : `${Math.round(rh)}%`,
      frac: rh == null ? null : clamp01(rh / 100),
      min: '0%',
      max: '100%',
      note: node && !kindState(node, 'climate').present ? '미설치' : undefined,
    },
    soil: {
      label: '토양 수분',
      value: soil == null ? '--' : soil.toFixed(2),
      frac: soil == null ? null : clamp01(soil),
      min: '0',
      max: '1',
      note: !node ? undefined : !soilState.present ? '미설치' : soilState.status === 'info' ? '보정 전' : undefined,
    },
    weight: {
      label: '무게',
      value: w == null ? '--' : Math.round(w).toLocaleString('en-US'),
      unit: w == null ? undefined : 'g',
      frac: w == null ? null : clamp01(w / 3000),
      min: '0',
      max: '3,000',
      note: node && !kindState(node, 'weight').present ? '미설치' : undefined,
    },
  }
}

/** 큰 식물 사진 + 측정값 4개 (디자인 01 가운데) */
function Hero({ id }: { id: NodeId }) {
  const node = useNode(id)
  const { stale } = useFreshness(node?.last_seen)
  const m = metrics(node)
  const dim = stale || !node?.online
  return (
    <div className="relative -mx-[26px] aspect-[670/600] lg:mx-0 lg:mt-6">
      <img src="/design/home-hero.jpg" alt="" className="hero-fade absolute inset-0 size-full object-cover" />
      <MetricBlock m={m.temp} dim={dim} className="top-[15.5%] left-[26px] lg:left-[5%]" />
      <MetricBlock m={m.rh} dim={dim} className="top-[39.5%] left-[26px] lg:left-[5%]" />
      <MetricBlock m={m.soil} dim={dim} className="top-[5.5%] left-[79.5%]" />
      <MetricBlock m={m.weight} dim={dim} className="top-[35.5%] left-[79.5%]" />
    </div>
  )
}

/** 구역 동그라미 (디자인 01 아래): 고른 구역은 연두 고리(토양 수분만큼), 다시 누르면 구역 상세로 */
function ZoneDock({ ids, active, onPick }: { ids: NodeId[]; active: NodeId; onPick: (id: NodeId) => void }) {
  const navigate = useNavigate()
  const nodes = useAppStore((s) => s.nodes)
  return (
    <div className="relative -mt-[22px] flex items-start justify-between px-1 lg:mt-10 lg:max-w-[440px]">
      {ids.slice(0, 3).map((id) => {
        const p = zoneProfile(id)
        const on = id === active
        const soil = values(nodes[id]?.latest).soil
        const ring = on ? (num(soil) ? clamp01(soil) : 1) : 0
        const inner = on ? 64 : 70
        return (
          <button
            key={id}
            type="button"
            aria-label={on ? `${id} ${p.nameKo} 상세 보기` : `${id} ${p.nameKo} 고르기`}
            aria-pressed={on}
            onClick={() => (on ? navigate(`/zone/${id}`) : onPick(id))}
            className="flex flex-col items-center gap-[7px]"
          >
            <span className="relative flex size-[76px] items-center justify-center">
              {on ? (
                <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle
                    cx="38"
                    cy="38"
                    r="36"
                    fill="none"
                    stroke="var(--ds-lime)"
                    strokeOpacity=".3"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="38"
                    cy="38"
                    r="36"
                    fill="none"
                    stroke="var(--ds-lime)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={`${ring * 226.2} 226.2`}
                  />
                </svg>
              ) : null}
              <span
                className="overflow-hidden rounded-full border border-white/20 bg-[var(--ds-glass)] backdrop-blur"
                style={{ width: inner, height: inner }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="" className={cn('size-full object-cover', !on && 'opacity-80')} />
                ) : null}
              </span>
            </span>
            <span className="text-[13px] font-medium" style={{ textShadow: 'var(--ds-shadow-text)' }}>
              {id}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        aria-label="구역 추가 안내"
        onClick={() =>
          toast.info(
            '구역 추가',
            'ESP32를 하나 더 켜면 자동으로 생겨요. 보드마다 시리얼에서 "id z2"처럼 이름을 정해 주세요',
          )
        }
        className="mt-[3px] flex size-[70px] items-center justify-center rounded-full border border-white/40 bg-white/25 text-[30px] font-extralight backdrop-blur-md"
      >
        +
      </button>
    </div>
  )
}

/** 오늘 급수량 + 급수하기 (디자인 01 맨 아래 밝은 유리 카드) */
function WaterCard({ id }: { id: NodeId }) {
  const node = useNode(id)
  const today = node?.pump.today_ml ?? 0
  const limit = num(node?.info?.day_limit_ml) ? node.info.day_limit_ml : 300
  const noPump = node ? !node.sensors.pump.present : false
  return (
    <section
      aria-label="오늘 급수량"
      className="-mx-5 mt-[18px] flex lg:mx-0 lg:mt-8 lg:max-w-[460px] items-center justify-between gap-3 rounded-[34px] border border-white/35 bg-[var(--ds-glass-light)] py-[18px] pr-[14px] pl-[24px] backdrop-blur-xl"
      style={{ textShadow: 'var(--ds-shadow-text)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-white/90">
          오늘 급수량{noPump ? <span className="ml-1 text-white/70">· 펌프 미설치</span> : null}
        </div>
        <div className="num mt-0.5 text-[22px] leading-tight font-light">
          <span className="font-semibold">{Math.round(today)}</span> / {limit} mL
        </div>
        <div className="mt-2 h-[5px] w-full max-w-[175px] rounded-full bg-black/15">
          <div
            className="h-full rounded-full bg-[var(--ds-lime)]"
            style={{ width: `${clamp01(today / limit) * 100}%` }}
          />
        </div>
      </div>
      <Link
        to={`/water/${id}`}
        className="flex h-[52px] shrink-0 items-center gap-5 rounded-full bg-ds-btn px-[22px] text-[14px] font-semibold text-ds-btn-ink shadow-[0_6px_16px_rgba(0,0,0,.08)]"
        style={{ textShadow: 'none' }}
      >
        급수하기
        <span aria-hidden className="text-[17px]">
          →
        </span>
      </Link>
    </section>
  )
}

export default function HomePage() {
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const ids = zoneIds(seen)
  const firstOnline = useAppStore((s) => ids.find((id) => s.nodes[id]?.online))
  const [picked, setPicked] = useState<NodeId | null>(null)
  const active = picked ?? firstOnline ?? ids[0]
  const node = useNode(active)
  const { ago } = useFreshness(node?.last_seen)
  const configError = useAppStore((s) => s.configError)
  const p = zoneProfile(active)

  const sub = configError
    ? 'Supabase 설정이 없어요'
    : !node?.last_seen
      ? '아직 신호가 없어요'
      : node.online
        ? `최근 업데이트 ${ago}`
        : `연결 끊김 · 마지막 값 ${ago}`

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-12">
      <section
        className="mt-[30px] lg:col-start-1 lg:row-start-1 lg:mt-16"
        style={{ textShadow: 'var(--ds-shadow-text)' }}
      >
        <h1 className="font-light tracking-[-0.025em]">
          <span className="block text-[70px] leading-[0.95] lg:text-[104px]">{active}</span>
          <span className="mt-[6px] block text-[61px] leading-[1.05] lg:text-[88px]">{p.name}</span>
        </h1>
        <p
          className={cn(
            'mt-[10px] text-[12.5px] text-ds-text-2',
            node?.last_seen && !node.online && 'text-[var(--ds-warn)]',
          )}
        >
          {sub}
        </p>
      </section>
      <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-center">
        <Hero id={active} />
      </div>
      <div className="lg:col-start-1 lg:row-start-2">
        <ZoneDock ids={ids} active={active} onPick={setPicked} />
      </div>
      <div className="lg:col-start-1 lg:row-start-3">
        <WaterCard id={active} />
      </div>
    </div>
  )
}
