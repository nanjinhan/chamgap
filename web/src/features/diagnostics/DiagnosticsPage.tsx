import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ChevronRight } from 'lucide-react'
import { CornerPlant, Panel, PanelHeader, StatusLabel } from '@/components/ds/ui'
import { zoneIds, zoneProfile } from '@/config/zones'
import { useNow } from '@/hooks/useNow'
import { useDiagServer } from '@/lib/diagServer'
import { fmtAgo } from '@/lib/format'
import { parseTs } from '@/lib/nodeState'
import { sensorState } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { Diagnostic, DiagSeverity, NodeState, SensorKey, Severity } from '@/types/api'

/**
 * 진단 목록 (W5·UI-13): 진단 서버가 diagnostics 표에 쓴 것만 보여 준다 (웹은 진단을 만들지 않는다).
 * 아래 '연결·보정 상태'는 진단이 아니라 데이터가 말하는 사실(끊김·보정 전·읽기 실패·미설치)이다.
 */

const SENSOR_KO: Record<string, string> = {
  sht_a: '온습도 A(대상)',
  sht_b: '온습도 B(비교)',
  soil_a: '토양 A(대상)',
  soil_b: '토양 B(비교)',
  scale: '무게',
  pump: '펌프',
  power: '전원',
  node: '구역',
}
const ORDER: DiagSeverity[] = ['fault', 'warn', 'info', 'offline']
const FILTERS: { key: 'all' | DiagSeverity; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'fault', label: '고장' },
  { key: 'warn', label: '주의' },
  { key: 'info', label: '정보' },
]

function DiagCard({ d }: { d: Diagnostic }) {
  const now = useNow()
  const mins = Math.max(0, Math.floor((now - parseTs(d.since)) / 60_000))
  return (
    <article
      className={cn(
        'rounded-[18px] border bg-[var(--ds-panel)] p-3.5 backdrop-blur-md',
        d.severity === 'fault' ? 'border-[var(--ds-fault)]/60' : 'border-[var(--ds-panel-line)]',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] text-ds-text-2">
        <StatusLabel status={d.severity} />
        <span>
          {d.node} · {SENSOR_KO[d.sensor] ?? d.sensor} · {mins < 60 ? `${mins}분째` : `${Math.floor(mins / 60)}시간째`}
        </span>
      </div>
      <h3 className="mt-1.5 text-[15.5px] font-semibold">{d.title}</h3>
      {d.detail ? <p className="mt-0.5 text-[13px] text-ds-text-2">{d.detail}</p> : null}
      {d.checks[0] ? <p className="mt-1.5 text-[12px] text-ds-text-3">확인: {d.checks[0]}</p> : null}
      {d.action ? (
        <Link to={d.action.to} className="mt-2 inline-flex items-center gap-0.5 text-[13px] text-[var(--ds-lime)]">
          {d.action.label}
          <ChevronRight size={14} />
        </Link>
      ) : null}
    </article>
  )
}

type Fact = { key: string; status: Severity; text: string; to?: string; more?: string }

/** 데이터가 말하는 사실 (진단 아님) */
function facts(ids: string[], nodes: Record<string, NodeState>, now: number): Fact[] {
  const out: Fact[] = []
  for (const id of ids) {
    const n = nodes[id]
    const name = `${id} ${zoneProfile(id).nameKo}`
    if (!n?.last_seen) {
      out.push({ key: `${id}-none`, status: 'offline', text: `${name} · 아직 신호가 없어요` })
      continue
    }
    if (!n.online) {
      out.push({
        key: `${id}-off`,
        status: 'offline',
        text: `${name} · 연결 끊김 (마지막 값 ${fmtAgo(n.last_seen, now)})`,
        to: '/settings',
        more: '보드 상태',
      })
      continue
    }
    for (const k of ['sht_a', 'sht_b', 'soil_a', 'soil_b', 'scale'] as SensorKey[]) {
      const s = sensorState(n, k)
      if (!s.present) continue
      if (s.status === 'fault')
        out.push({ key: `${id}-${k}`, status: 'fault', text: `${id} ${SENSOR_KO[k]} · 값을 읽지 못해요` })
      if (s.status === 'info')
        out.push({
          key: `${id}-${k}`,
          status: 'info',
          text: `${id} ${SENSOR_KO[k]} · 보정 전`,
          to: `/calibrate/${id}/${k === 'scale' ? 'scale' : 'soil'}`,
          more: '보정하기',
        })
    }
    if (n.sensors.pump.present && n.sensors.pump.status === 'info')
      out.push({
        key: `${id}-pump`,
        status: 'info',
        text: `${id} 펌프 · 유량 보정 전 (mL 급수 불가)`,
        to: `/calibrate/${id}/flow`,
        more: '보정하기',
      })
  }
  return out
}

export default function DiagnosticsPage() {
  const now = useNow()
  const [filter, setFilter] = useState<'all' | DiagSeverity>('all')
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const nodes = useAppStore((s) => s.nodes)
  const resolved = useAppStore(useShallow((s) => s.events.filter((e) => e.kind === 'diag_off').slice(0, 10)))
  const server = useDiagServer()
  const ids = zoneIds(seen)
  const all = ids
    .flatMap((id) => (nodes[id]?.online ? nodes[id].diagnostics : []))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
  const shown = filter === 'all' ? all : all.filter((d) => d.severity === filter)
  const zonesWith = new Set(all.map((d) => d.node)).size
  const fs = facts(ids, nodes, now)

  return (
    <div className="relative">
      <CornerPlant
        src="/design/leaves-top.jpg"
        className="-top-[64px] -right-4 h-[260px] w-[58%] opacity-70 lg:right-0"
      />
      <div className="relative mt-7 pl-2">
        <div className="text-[13px] tracking-[0.1em] text-ds-text-3">CHECK</div>
        <h1 className="mt-2 text-[30px] leading-[1.25] font-semibold">
          지금 믿기 어려운 값
          <br />
          {all.length}개
        </h1>
        <p className="mt-2 text-[14px] text-ds-text-2">
          {ids.length}구역 중 {zonesWith}구역
        </p>
      </div>
      <div className="relative mt-5 lg:grid lg:grid-cols-[1.4fr_1fr] lg:gap-4">
        <div className="space-y-2.5">
          {server.alive === false ? (
            <Panel aria-label="진단 서버 꺼짐">
              <StatusLabel status="offline" text="진단 서버가 꺼져 있어요" />
              <p className="mt-1.5 text-[13px] leading-relaxed text-ds-text-2">
                값 보기·급수·보정은 그대로 쓸 수 있어요. 센서를 믿어도 되는지 알려 주는 진단은 노트북에서 진단 서버를
                켜면 여기에 나타나요.
              </p>
            </Panel>
          ) : null}
          <div className="flex gap-1.5" role="radiogroup" aria-label="단계">
            {FILTERS.map((f) => {
              const n = f.key === 'all' ? all.length : all.filter((d) => d.severity === f.key).length
              return (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'h-[34px] rounded-full px-3.5 text-[13px]',
                    filter === f.key ? 'bg-[var(--ds-green)] font-semibold' : 'border border-white/15 bg-white/[0.06]',
                  )}
                >
                  {f.label} {n}
                </button>
              )
            })}
          </div>
          {shown.length ? (
            shown.map((d) => <DiagCard key={`${d.node}:${d.code}:${d.sensor}`} d={d} />)
          ) : (
            <p className="rounded-[18px] border border-white/10 bg-white/[0.05] px-4 py-6 text-center text-[13.5px] text-ds-text-2">
              {server.alive ? '지금 의심스러운 값이 없어요' : '진단 서버가 켜지면 진단이 여기에 나타나요'}
            </p>
          )}
        </div>
        <div className="mt-2.5 space-y-2.5 lg:mt-0">
          <Panel aria-label="연결·보정 상태">
            <PanelHeader
              title="연결·보정 상태"
              right={<span className="text-[11.5px] text-ds-text-3">진단 아님 · 데이터 그대로</span>}
            />
            {fs.length ? (
              <ul className="space-y-2">
                {fs.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-center justify-between gap-2 rounded-[12px] bg-white/[0.06] px-3 py-2.5"
                  >
                    <StatusLabel status={f.status} text={f.text} className="text-[13px] text-white" />
                    {f.to ? (
                      <Link to={f.to} className="inline-flex shrink-0 items-center text-[12px] text-[var(--ds-lime)]">
                        {f.more}
                        <ChevronRight size={13} />
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <StatusLabel status="ok" text="모든 구역 연결·보정 정상" />
            )}
          </Panel>
          <Panel aria-label="해결된 진단">
            <PanelHeader title={`해결된 진단 ${resolved.length}개`} />
            {resolved.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {resolved.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {e.node} · {String(e.payload.title ?? e.payload.code ?? '진단')}
                    </span>
                    <span className="num shrink-0 text-ds-text-3">{fmtAgo(e.time, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ds-text-3">아직 없어요</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
