import type {
  DataMsg,
  Diagnostic,
  EventRow,
  InfoMsg,
  NodeId,
  NodeRow,
  NodeState,
  PumpState,
  ReadingRow,
  SensorKey,
  SensorState,
  Severity,
} from '@/types/api'

/**
 * Supabase 행 → 화면이 쓰는 구역 상태(NodeState).
 * 진단 문구·기준값은 만들지 않는다 (진단 서버 몫, SYS-06). 여기서 정하는 상태는 데이터가 직접 말해 주는 것뿐:
 *  - 끊김: 마지막 측정값이 3 × sample_ms(최소 15초)보다 오래됨 (UI-11)
 *  - 고장: 펌웨어가 "이번 읽기 실패"라고 보낸 것 (sht_*_ok=0, hx_ok=0, 토양 전압은 있는데 값이 null)
 *  - 정보: 보정 전 (info의 soil_*_cal·lc_cal=0, pump_mlps=0)
 *  - 진단 서버가 diagnostics 표에 쓴 것이 있으면 그 단계를 더한다
 */

/** 구역 하나에 대해 Supabase에서 모은 것 */
export type NodeParts = {
  row: NodeRow | null
  reading: ReadingRow | null
  pumpOn: EventRow | null
  pumpOff: EventRow | null
  diagnostics: Diagnostic[]
}

export const emptyParts = (): NodeParts => ({ row: null, reading: null, pumpOn: null, pumpOff: null, diagnostics: [] })

const SEV_ORDER: Severity[] = ['ok', 'info', 'warn', 'fault', 'offline']
export const worst = (...s: Severity[]): Severity =>
  s.reduce((a, b) => (SEV_ORDER.indexOf(b) > SEV_ORDER.indexOf(a) ? b : a), 'ok')

/** Supabase 시각 문자열 → ms (마이크로초·"+00" 꼴도 받는다) */
export function parseTs(s: string | null | undefined): number {
  if (!s) return NaN
  const iso = s
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
  return Date.parse(iso)
}

/** 측정값 행 → data 메시지 모양 (표에 없던 키는 extra에서 꺼낸다, COM-09) */
export function toDataMsg(r: ReadingRow): DataMsg {
  const { id: _id, extra, ...cols } = r
  void _id
  return { ...(extra ?? {}), ...cols, t: 'data' }
}

/** 이 시간보다 오래 측정값이 없으면 끊김 */
export function offlineAfterMs(info: InfoMsg | null): number {
  const sample = typeof info?.sample_ms === 'number' ? info.sample_ms : 5000
  return Math.max(15_000, 3 * sample)
}

const PRESENT_KEY: Record<SensorKey, keyof InfoMsg> = {
  sht_a: 'sht_a_present',
  sht_b: 'sht_b_present',
  soil_a: 'soil_a_present',
  soil_b: 'soil_b_present',
  scale: 'hx_present',
  pump: 'pump_present',
  power: 'v12_sense',
}

function isPresent(k: SensorKey, info: InfoMsg | null, d: DataMsg | null): boolean {
  if (!info) return k === 'power' ? typeof d?.v12 === 'number' : true // 아직 모르면 달린 것으로
  const v = info[PRESENT_KEY[k]]
  return !(v === 0 || v === false)
}

function soilStatus(mv: unknown, value: unknown, cal: unknown): Severity {
  if (typeof mv === 'number' && value == null) return 'fault' // 선 빠짐·단락으로 값을 못 냄
  if (cal === 0) return 'info'
  return 'ok'
}

function dataStatus(k: SensorKey, d: DataMsg | null, info: InfoMsg | null): Severity {
  switch (k) {
    case 'sht_a':
      return d?.sht_a_ok === 0 ? 'fault' : 'ok'
    case 'sht_b':
      return d?.sht_b_ok === 0 ? 'fault' : 'ok'
    case 'soil_a':
      return soilStatus(d?.soil_a_mv, d?.soil_a, info?.soil_a_cal)
    case 'soil_b':
      return soilStatus(d?.soil_b_mv, d?.soil_b, info?.soil_b_cal)
    case 'scale':
      return d?.hx_ok === 0 ? 'fault' : info?.lc_cal === 0 ? 'info' : 'ok'
    case 'pump':
      return info?.pump_mlps === 0 ? 'info' : 'ok'
    case 'power':
      return 'ok'
  }
}

function pumpState(p: NodeParts, d: DataMsg | null, now: number): PumpState {
  const on = p.pumpOn
  const off = p.pumpOff
  const onAt = parseTs(on?.created_at)
  const dur = typeof on?.payload.dur === 'number' ? on.payload.dur : null
  // 마지막 pump_on 뒤에 pump_off가 없고, 정해진 시간(+5초)이 안 지났고, 그 뒤 측정값이 "꺼짐"이라고 하지 않으면 켜짐
  let running = false
  if (on && (!off || onAt > parseTs(off.created_at)) && now - onAt < (dur ?? 15_000) + 5_000) {
    const after = p.reading && parseTs(p.reading.created_at) > onAt + 1_000
    running = !(after && d?.pump === 0)
  } else if (!on && !off) {
    running = d?.pump === 1
  }
  const ml = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    on: running,
    started_at: running ? (on?.created_at ?? null) : null,
    dur: running ? dur : null,
    ml: running ? ml(on?.payload.ml) : null,
    last_ml: ml(off?.payload.ml),
    last_at: off?.created_at ?? null,
    today_ml: p.row?.day_ml ?? (typeof p.row?.info?.day_ml === 'number' ? p.row.info.day_ml : 0),
  }
}

export function buildNode(id: NodeId, p: NodeParts, now: number): NodeState {
  const latest = p.reading ? toDataMsg(p.reading) : null
  const info = p.row?.info ?? null
  const lastSeen = p.reading?.created_at ?? null
  const online = lastSeen != null && now - parseTs(lastSeen) <= offlineAfterMs(info)

  const sensors = {} as Record<SensorKey, SensorState>
  for (const k of Object.keys(PRESENT_KEY) as SensorKey[]) {
    const present = isPresent(k, info, latest)
    let status: Severity = 'ok'
    if (!online) status = 'offline'
    else if (present) {
      const diag = p.diagnostics.filter((x) => x.sensor === k).map((x) => x.severity)
      status = worst(dataStatus(k, latest, info), ...diag)
    }
    sensors[k] = { status, present }
  }

  const nodeDiag = p.diagnostics.filter((x) => x.sensor === 'node').map((x) => x.severity)
  const status: Severity = online
    ? worst(
        ...Object.values(sensors)
          .filter((x) => x.present)
          .map((x) => x.status),
        ...nodeDiag,
      )
    : 'offline'

  return {
    node: id,
    online,
    last_seen: lastSeen,
    status,
    latest,
    info,
    pump: pumpState(p, latest, now),
    sensors,
    diagnostics: p.diagnostics,
  }
}
