/**
 * 서버와 주고받는 형식 (요구사항지시서 4.2 메시지, 5.3 상태, 6.2 진단).
 * 서버는 키를 더 보낼 수 있으므로 [key: string]: unknown 을 허용한다 (COM-09).
 */

export type NodeId = string
export type Severity = 'ok' | 'info' | 'warn' | 'fault' | 'offline'
export type DiagSeverity = Exclude<Severity, 'ok'>
export type SensorKey = 'sht_a' | 'sht_b' | 'soil_a' | 'soil_b' | 'scale' | 'pump' | 'power'
export const SENSOR_KEYS: SensorKey[] = ['sht_a', 'sht_b', 'soil_a', 'soil_b', 'scale', 'pump', 'power']

type Extra = { [key: string]: unknown }
type Bit = 0 | 1

interface Base extends Extra {
  t: string
  node?: string
  ms?: number | null
  pc_time: string
  src: string
}

/** 주기 측정값 (4.2 data) */
export interface DataMsg extends Base {
  t: 'data'
  node: string
  seq?: number
  sht_a_ok?: Bit
  temp_a?: number | null
  rh_a?: number | null
  sht_b_ok?: Bit
  temp_b?: number | null
  rh_b?: number | null
  soil_a_mv?: number | null
  soil_a?: number | null
  soil_b_mv?: number | null
  soil_b?: number | null
  hx_ok?: Bit
  weight_g?: number | null
  weight_sd?: number | null
  v12?: number | null
  leak?: Bit | null
  pump?: Bit
  rssi?: number | null
}

export type PumpReason =
  'done' | 'stop' | 'no_12v' | 'leak' | 'reboot' | 'already_on' | 'bad_ms' | 'cooldown' | (string & {})

/** 사건 (4.2 evt) */
export interface EvtMsg extends Base {
  t: 'evt'
  ev: 'boot' | 'pump_on' | 'pump_off' | 'refused' | (string & {})
  dur?: number | null
  ran?: number | null
  ml?: number | null
  reason?: PumpReason
  fw?: string
  reset?: number
}

/** 명령 응답 (4.2 ack) */
export interface AckMsg extends Base {
  t: 'ack'
  cmd: string
  ok: Bit
  msg: string
}

/** 설정·보정 상태 (4.2 info) */
export interface InfoMsg extends Base {
  t: 'info'
  fw?: string
  sample_ms?: number
  soil_cal?: Bit
  soil_a_air?: number
  soil_a_wet?: number
  soil_b_air?: number
  soil_b_wet?: number
  lc_cal?: Bit
  lc_offset?: number
  lc_scale?: number
  pump_mlps?: number
  v12_sense?: Bit
  leak_sensor?: Bit
  mqtt?: Bit
}

/** 시험 스케치 메시지 (node 없음) */
export interface TestMsg extends Base {
  t: string
}

/** 진단 (6.2) */
export interface Diagnostic {
  code: string
  node: NodeId
  sensor: SensorKey | 'node'
  severity: DiagSeverity
  title: string
  detail: string
  causes: string[]
  checks: string[]
  since: string
  action?: { label: string; to: string } | null
  values?: Record<string, unknown>
}

export interface PumpState {
  on: boolean
  started_at: string | null
  dur: number | null
  ml: number | null
  last_ml: number | null
  last_at: string | null
  today_ml: number
}

export interface SensorState {
  status: Severity
  value: unknown
}

/** 구역 상태 (5.3) */
export interface NodeState {
  node: NodeId
  src: string | null
  online: boolean
  last_seen: string | null
  status: Severity
  latest: DataMsg | null
  info: InfoMsg | null
  pump: PumpState
  sensors: Record<SensorKey, SensorState>
  diagnostics: Diagnostic[]
}

export interface LinkPort {
  port: string
  connected: boolean
  node?: string | null
  error?: string | null
  hint?: string | null
  desc?: string
  scenario?: string
}

export interface LinkStatus extends Extra {
  mode: 'serial' | 'mqtt' | 'mock'
  ports: LinkPort[]
  server_time: string
  mock: boolean
  allow_raw: boolean
  pin_required: boolean
  urls?: string[]
  scenarios?: string[]
  speed?: number
  broker?: string
  connected?: boolean
  error?: string | null
  hint?: string | null
}

export interface AppState {
  server_time: string
  link: LinkStatus
  nodes: Record<NodeId, NodeState>
}

/** 서버가 만든 사건 (WebSocket evt의 payload.t) */
export interface WaterResult extends Extra {
  t: 'water_result'
  node: NodeId
  kind?: 'water' | 'flow_cal'
  expected_ml?: number | null
  before_g?: number | null
  after_g?: number | null
  delta_g?: number | null
  verdict?: 'ok' | 'not_arrived' | 'over' | 'unknown' | 'skipped'
  reason?: string | null
}

export interface MarkItem extends Extra {
  t: 'mark'
  node: NodeId | null
  note: string
  pc_time: string
}

export interface LogPayload {
  src: string | null
  text: string
  pc_time: string
  note: boolean
  bad_json: boolean
  dir: 'rx' | 'tx'
  sent?: boolean
}

type WsBase = { server_time?: string }

export type WsMessage =
  | (WsBase & { type: 'snapshot'; state: AppState })
  | (WsBase & { type: 'data'; node: NodeId; payload: DataMsg; online?: boolean; last_seen?: string })
  | (WsBase & {
      type: 'evt'
      node: NodeId | null
      payload: EvtMsg | WaterResult | MarkItem | InfoMsg
      pump?: PumpState
      info?: InfoMsg
    })
  | (WsBase & { type: 'ack'; node: NodeId; payload: AckMsg })
  | (WsBase & {
      type: 'diag'
      node: NodeId
      payload: { diagnostics: Diagnostic[]; status: Severity; sensors: Record<SensorKey, SensorState>; online: boolean }
    })
  | (WsBase & { type: 'link'; node: NodeId | null; payload: { event: string; link: LinkStatus } & Extra })
  | (WsBase & { type: 'log'; node: NodeId | null; payload: LogPayload })
  | (WsBase & { type: 'test'; node: null; payload: TestMsg })
  | (WsBase & { type: 'ping' })

export interface PreflightCheck {
  key: string
  ok: boolean
  label_ko: string
  detail_ko: string
}

export interface Preflight {
  ok: boolean
  error: string | null
  message: string | null
  checks: PreflightCheck[]
}

export interface EventItem {
  id: number
  node: NodeId | null
  ts: number
  time: string
  kind: 'evt' | 'ack' | 'info' | 'diag_on' | 'diag_off' | 'command' | 'mark' | 'water_result' | 'link' | (string & {})
  payload: Record<string, unknown>
}

export type Metric =
  | 'temp_a'
  | 'rh_a'
  | 'temp_b'
  | 'rh_b'
  | 'soil_a'
  | 'soil_b'
  | 'soil_a_mv'
  | 'soil_b_mv'
  | 'weight_g'
  | 'weight_sd'
  | 'v12'

export interface HistoryPoint extends Partial<Record<Metric, number | null>> {
  ts: number
  t: string
}

export interface HistoryResponse {
  ok: true
  node: NodeId
  metrics: Metric[]
  minutes: number
  bucket: number
  points: HistoryPoint[]
}

export interface FlowCalResult {
  ok: true
  ms: number
  ran: number | null
  reason: string | null
  before_g: number | null
  after_g: number | null
  delta_g: number | null
}

export interface ApiErrorBody {
  ok: false
  error: string
  message: string
  checks?: PreflightCheck[]
  ack?: AckMsg | null
}
