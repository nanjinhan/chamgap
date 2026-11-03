import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { RotateCcw } from 'lucide-react'
import { Panel, PanelHeader, StatusLabel } from '@/components/ds/ui'
import { zoneIds, zoneProfile } from '@/config/zones'
import { useNow } from '@/hooks/useNow'
import { sendCommand } from '@/lib/commands'
import { useDiagServer } from '@/lib/diagServer'
import { fmtAgo } from '@/lib/format'
import { isNum } from '@/lib/readings'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useSettings } from '@/store/useSettings'
import { toast } from '@/store/useToasts'
import type { NodeId } from '@/types/api'

/**
 * 설정 (W10): 연결 상태, 구역별 보드 상태(펌웨어가 info에 실어 보내는 WiFi·메모리 숫자), 측정 주기, 화면 설정.
 */

// ESP32 wifi_err_reason_t (펌웨어 cloud.h 와 같은 뜻)
const WIFI_REASON: Record<number, string> = {
  0: '없음',
  2: '인증 만료',
  8: '보드가 연결을 끊음',
  15: '비밀번호 오류',
  200: '공유기 신호가 사라짐',
  201: 'WiFi 이름을 못 찾음',
  202: '비밀번호 오류',
  204: '비밀번호 오류',
}

const INTERVALS = [
  { ms: 5000, label: '5초' },
  { ms: 10000, label: '10초' },
  { ms: 30000, label: '30초' },
]

function uptime(s: number): string {
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}시간 ${m % 60}분` : `${Math.floor(h / 24)}일 ${h % 24}시간`
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-[13.5px]">
      <dt className="text-ds-text-2">{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  )
}

function ZoneBoard({ id }: { id: NodeId }) {
  const now = useNow()
  const node = useAppStore((s) => s.nodes[id])
  const [busy, setBusy] = useState<string | null>(null)
  const p = zoneProfile(id)
  const info = node?.info
  const d = node?.latest
  const run = async (cmd: string, ok: string) => {
    setBusy(cmd)
    const r = await sendCommand(id, cmd)
    setBusy(null)
    if (r.ok) toast.ok(ok)
    else toast.error('보드가 처리하지 못했어요', r.message)
  }
  const status = !node?.last_seen
    ? { s: 'offline' as const, t: '아직 신호 없음' }
    : node.online
      ? { s: 'ok' as const, t: '연결됨' }
      : { s: 'offline' as const, t: `끊김 · ${fmtAgo(node.last_seen, now)}` }
  const reason = isNum(info?.wifi_reason) ? (WIFI_REASON[info.wifi_reason] ?? `이유 ${info.wifi_reason}`) : '--'
  return (
    <Panel aria-label={`${id} 보드`}>
      <PanelHeader
        title={
          <span>
            {id} <span className="text-[13px] font-normal text-ds-text-2">{p.nameKo}</span>
          </span>
        }
        right={<StatusLabel status={status.s} text={status.t} />}
      />
      {node?.last_seen ? (
        <>
          <dl className="divide-y divide-white/10">
            <Row k="펌웨어" v={info?.fw ?? '--'} />
            <Row k="WiFi 세기" v={isNum(d?.rssi) ? `${d.rssi} dBm` : '--'} />
            <Row k="켜진 지" v={isNum(info?.up_s) ? uptime(info.up_s) : '--'} />
            <Row
              k="WiFi 끊긴 횟수 · 마지막 이유"
              v={isNum(info?.wifi_drops) ? `${info.wifi_drops}번 · ${reason}` : '--'}
            />
            <Row k="연결 실패(HTTPS)" v={isNum(info?.net_fail) ? `${info.net_fail}번` : '--'} />
            <Row
              k="남은 메모리 (최저)"
              v={
                isNum(info?.heap)
                  ? `${Math.round(info.heap / 1024)} KB (${isNum(info.heap_min) ? Math.round(info.heap_min / 1024) : '--'} KB)`
                  : '--'
              }
            />
          </dl>
          <div className="mt-3">
            <div className="text-[12.5px] text-ds-text-2">측정 주기</div>
            <div className="mt-1.5 flex gap-1.5">
              {INTERVALS.map((it) => (
                <button
                  key={it.ms}
                  type="button"
                  disabled={!node.online || !!busy}
                  aria-pressed={info?.sample_ms === it.ms}
                  onClick={() => void run(`interval ${it.ms}`, `${id} 측정 주기를 ${it.label}로 바꿨어요`)}
                  className={cn(
                    'h-[34px] rounded-full px-3.5 text-[13px] disabled:opacity-45',
                    info?.sample_ms === it.ms
                      ? 'bg-[var(--ds-green)] font-semibold'
                      : 'border border-white/15 bg-white/[0.06]',
                  )}
                >
                  {it.label}
                </button>
              ))}
              <button
                type="button"
                disabled={!node.online || !!busy}
                onClick={() => void run('info', `${id} 설정을 다시 받았어요`)}
                className="ml-auto inline-flex h-[34px] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[12.5px] disabled:opacity-45"
              >
                <RotateCcw size={13} strokeWidth={1.7} aria-hidden />
                다시 받기
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-ds-text-3">
              주기를 늘리면 무료 사용량을 덜 써요 (5초 × 3구역이 기본)
            </p>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ds-text-3">이 구역 ESP32를 켜면 여기에 보드 상태가 나와요.</p>
      )}
    </Panel>
  )
}

export default function SettingsPage() {
  const now = useNow()
  const conn = useAppStore((s) => s.conn)
  const seen = useAppStore(useShallow((s) => Object.keys(s.nodes)))
  const last = useAppStore(
    (s) =>
      Object.values(s.nodes)
        .map((n) => n.last_seen)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null,
  )
  const server = useDiagServer()
  const reduced = useSettings((s) => s.reducedMotion)
  const setReduced = useSettings((s) => s.setReducedMotion)
  const ids = zoneIds(seen)
  return (
    <>
      <div className="mt-7 pl-2">
        <div className="text-[13px] tracking-[0.1em] text-ds-text-3">SETTINGS</div>
        <h1 className="mt-2 text-[32px] font-semibold">설정</h1>
      </div>
      <div className="mt-5 lg:grid lg:grid-cols-2 lg:gap-4">
        <div className="space-y-2.5">
          <Panel aria-label="연결">
            <PanelHeader title="연결" />
            <dl className="divide-y divide-white/10">
              <Row k="Supabase 실시간" v={conn === 'open' ? '연결됨' : '연결하는 중…'} />
              <Row k="마지막 측정값" v={fmtAgo(last, now)} />
              <Row k="진단 서버" v={server.alive == null ? '확인 중' : server.alive ? '켜짐' : '꺼짐'} />
              <Row k="이 주소" v={typeof window === 'undefined' ? '' : window.location.host} />
            </dl>
          </Panel>
          <Panel aria-label="화면">
            <PanelHeader title="화면" />
            <label className="flex items-center justify-between gap-3 py-1 text-[14px]">
              <span>
                움직임 줄이기
                <span className="block text-[11.5px] text-ds-text-3">애니메이션을 끕니다 (기기 설정도 따릅니다)</span>
              </span>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
                className="size-[22px] accent-[#9fd062]"
              />
            </label>
          </Panel>
          <Panel aria-label="안내">
            <PanelHeader title="안내" />
            <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ds-text-2">
              <li>· 하드웨어 비상정지 스위치가 이 앱보다 항상 우선입니다.</li>
              <li>· 급수는 1초 길게 눌러야 시작되고, 최종 판단은 ESP32가 합니다 (1회 50mL, 하루 300mL, 15초).</li>
              <li>· 구역 식물 이름·사진은 web/src/config/zones.ts 에서 바꿉니다.</li>
              <li>· 기록은 14일, 사건은 30일 보관합니다.</li>
            </ul>
          </Panel>
        </div>
        <div className="mt-2.5 space-y-2.5 lg:mt-0">
          {ids.map((id) => (
            <ZoneBoard key={id} id={id} />
          ))}
        </div>
      </div>
    </>
  )
}
