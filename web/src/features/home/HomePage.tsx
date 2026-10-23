import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { IconCircle, SensorTile, StatusText } from '@/components/domain/SensorTile'
import { OUTLINE } from '@/components/fx/statusLook'
import { IconBell, IconDrop, IconPump, IconScale, IconThermo } from '@/components/icons'
import { useFreshness, useNode, useNodeIds } from '@/hooks/useNode'
import { useNow } from '@/hooks/useNow'
import { fmtAgo, fmtMl } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { NodeId, Severity } from '@/types/api'
import { ZoneCarousel } from './ZoneCarousel'

const SEV_ORDER: Severity[] = ['ok', 'info', 'warn', 'fault', 'offline']
const worst = (...s: Severity[]): Severity =>
  s.reduce((a, b) => (SEV_ORDER.indexOf(b) > SEV_ORDER.indexOf(a) ? b : a), 'ok')
const n1 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(1) : '--')
const n2 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(2) : '--')

/** 인사말 + "센서 21개 중 19개 정상 · 2초 전 갱신" + 알림 버튼 */
function HomeHeader() {
  const now = useNow()
  const s = useAppStore(
    useShallow((st) => {
      const nodes = Object.values(st.nodes)
      const sensors = nodes.flatMap((n) => Object.values(n.sensors))
      const issues = nodes.filter((n) => n.online).flatMap((n) => n.diagnostics).length
      const last =
        nodes
          .map((n) => n.last_seen)
          .filter((x): x is string => !!x)
          .sort()
          .at(-1) ?? null
      return { total: sensors.length, ok: sensors.filter((x) => x.status === 'ok').length, issues, last }
    }),
  )
  return (
    <div className="mt-[18px] flex items-center justify-between">
      <div>
        <h1 className="text-[20px] font-extrabold">안녕하세요, 참값팀</h1>
        <p className="num mt-0.5 text-[12.5px] text-ink-2">
          센서 {s.total}개 중 {s.ok}개 정상 · {fmtAgo(s.last, now)} 갱신
        </p>
      </div>
      <Link
        to="/diagnostics"
        aria-label={`알림 ${s.issues}개`}
        className="relative flex size-[42px] items-center justify-center rounded-full bg-white text-ink shadow-[0_6px_16px_rgba(40,90,180,.12)]"
      >
        <IconBell size={20} />
        {s.issues > 0 ? (
          <span className="absolute top-[9px] right-2.5 size-2 rounded-full border-2 border-white bg-[#e8590c] box-content" />
        ) : null}
      </Link>
    </div>
  )
}

/** 선택한 구역의 센서 카드 (와이어프레임 01 아래쪽) */
function ZoneSensors({ id }: { id: NodeId }) {
  const node = useNode(id)
  const now = useNow()
  const { stale } = useFreshness(node?.last_seen)
  if (!node) return null
  const d = node.latest
  const st = node.sensors
  const info = node.info
  // 펌웨어가 info에 알려 주는 '달린 센서' (없으면 고장이 아니라 미설치)
  const absent = (key: string) => info?.[key] === 0 || info?.[key] === false
  const sensorA = typeof info?.sensor_a === 'string' && info.sensor_a !== 'SHT31' ? info.sensor_a : null
  const raw = typeof d?.weight_raw === 'number' ? d.weight_raw : null
  const dT = typeof d?.temp_b === 'number' && typeof d?.temp_a === 'number' ? d.temp_b - d.temp_a : null
  const power = st.power.status
  const pumpStatus = worst(st.pump.status, power)
  const limit = typeof node.info?.day_limit_ml === 'number' ? node.info.day_limit_ml : 300
  const pumpTitle = node.pump.on
    ? '펌프 · 급수 중'
    : d?.v12 == null
      ? '펌프'
      : power === 'ok' || power === 'info'
        ? '펌프 · 12V 정상'
        : '펌프 · 12V 확인 필요'
  const last =
    node.pump.last_ml != null
      ? `마지막 급수 ${fmtMl(node.pump.last_ml)} · ${fmtAgo(node.pump.last_at, now)}`
      : '아직 급수 없음'

  return (
    <section aria-label={`${id} 센서`}>
      <div className="mt-3 flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold">{id} 센서</h2>
        <Link to="/diagnostics" className="rounded-full bg-white px-[11px] py-1 text-[12px] font-bold text-brand">
          진단 보기
        </Link>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <SensorTile
          to={`/zone/${id}/sensor/sht_a`}
          status={st.sht_a.status}
          icon={<IconThermo size={18} />}
          title="온습도 A"
          role={sensorA ? `대상 · ${sensorA}` : '대상'}
          value={`${n1(d?.temp_a)}°C · ${n1(d?.rh_a)}%`}
          stale={stale}
          absent={absent('sht_a_present')}
        />
        <SensorTile
          to={`/zone/${id}/sensor/sht_b`}
          status={st.sht_b.status}
          icon={<IconThermo size={18} />}
          title="온습도 B"
          role="비교"
          value={
            absent('sht_b_present')
              ? '아직 연결 안 함'
              : `${n1(d?.temp_b)}°C · A와 ${dT == null ? '--' : `${dT >= 0 ? '+' : ''}${dT.toFixed(1)}°C`}`
          }
          stale={stale}
          absent={absent('sht_b_present')}
        />
        <SensorTile
          to={`/zone/${id}/sensor/soil_a`}
          status={worst(st.soil_a.status, st.soil_b.status)}
          icon={<IconDrop size={18} />}
          title="토양 A · B"
          value={`${n2(d?.soil_a)} · ${n2(d?.soil_b)}`}
          stale={stale}
        />
        <SensorTile
          to={`/zone/${id}/sensor/scale`}
          status={st.scale.status}
          icon={<IconScale size={18} />}
          title="무게 (로드셀)"
          value={
            typeof d?.weight_g === 'number'
              ? `${d.weight_g.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g · ±${n1(d?.weight_sd)}`
              : raw != null
                ? `raw ${raw.toLocaleString('en-US')} · 보정 전`
                : '-- g'
          }
          stale={stale}
          absent={absent('hx_present')}
        />
        <Link
          to={`/water/${id}`}
          className={cn('card col-span-2 flex items-center gap-3 px-3 py-[11px]', OUTLINE[pumpStatus])}
        >
          <IconCircle status={pumpStatus}>
            <IconPump size={18} />
          </IconCircle>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              {pumpTitle}
              {pumpStatus !== 'ok' ? <StatusText status={pumpStatus} /> : null}
            </div>
            <div className="num text-[12px] text-ink-2">
              {last} · 오늘 {Math.round(node.pump.today_ml)}/{limit}mL
            </div>
          </div>
          <span className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-white">급수</span>
        </Link>
      </div>
    </section>
  )
}

export default function HomePage() {
  const ids = useNodeIds()
  const conn = useAppStore((s) => s.conn)
  const everOpened = useAppStore((s) => s.everOpened)
  const [index, setIndex] = useState(0)

  if (ids.length === 0) {
    return (
      <>
        <HomeHeader />
        <div className="card mt-6 px-4 py-5 text-center">
          {!everOpened || conn === 'connecting' ? (
            <p className="text-[14px] font-bold">서버에 연결하는 중…</p>
          ) : (
            <>
              <p className="text-[14px] font-bold">아직 ESP32 신호가 없어요</p>
              <p className="mt-1 text-[12px] text-ink-2">ESP32 전원과 WiFi 연결을 확인하세요</p>
            </>
          )}
        </div>
      </>
    )
  }

  const activeId = ids[Math.min(index, ids.length - 1)]
  return (
    <>
      <HomeHeader />
      <ZoneCarousel ids={ids} index={index} onIndex={setIndex} />
      <ZoneSensors id={activeId} />
    </>
  )
}
