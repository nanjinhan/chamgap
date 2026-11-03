/**
 * 데이터 형식 (요구사항지시서 v2.0 4.2 메시지, 4.4 Supabase 표, 6.2 진단).
 * ESP32가 키를 더 보낼 수 있으므로 [key: string]: unknown 을 허용한다 (COM-09).
 */

export type NodeId = string
export type Severity = 'ok' | 'info' | 'warn' | 'fault' | 'offline'
export type DiagSeverity = Exclude<Severity, 'ok'>
export type SensorKey = 'sht_a' | 'sht_b' | 'soil_a' | 'soil_b' | 'scale' | 'pump' | 'power'
export const SENSOR_KEYS: SensorKey[] = ['sht_a', 'sht_b', 'soil_a', 'soil_b', 'scale', 'pump', 'power']

type Extra = { [key: string]: unknown }
type Bit = 0 | 1

// ------------------------------------------------------------ Supabase 표의 행 (supabase/schema.sql)

/** readings: 주기 측정값 한 줄 (열 이름 = data 메시지 키) */
export interface ReadingRow {
  id: number
  created_at: string
  node: NodeId
  ms: number | null
  seq: number | null
  sht_a_ok: Bit | null
  temp_a: number | null
  rh_a: number | null
  sht_b_ok: Bit | null
  temp_b: number | null
  rh_b: number | null
  soil_a_mv: number | null
  soil_a: number | null
  soil_b_mv: number | null
  soil_b: number | null
  hx_ok: Bit | null
  weight_g: number | null
  weight_sd: number | null
  weight_raw: number | null
  v12: number | null
  leak: Bit | null
  pump: Bit | null
  rssi: number | null
  extra: Extra | null
}

/** nodes: 구역별 마지막 설정·상태 (ESP32가 upsert) */
export interface NodeRow {
  node: NodeId
  updated_at: string
  last_seen: string | null
  fw: string | null
  info: InfoMsg | null
  pump: Bit
  day_ml: number
}

/** events: ESP32의 evt·info, 웹의 메모, 진단 서버의 diag_on/off·water_result */
export interface EventRow {
  id: number
  created_at: string
  node: NodeId | null
  t: 'evt' | 'info' | 'mark' | 'diag_on' | 'diag_off' | 'water_result'
  ev: string | null
  payload: Extra
}

export type CommandStatus = 'pending' | 'sent' | 'done' | 'failed' | 'expired'

/** commands: 웹이 넣고 ESP32가 결과를 적는다 */
export interface CommandRow {
  id: number
  created_at: string
  node: NodeId
  cmd: string
  status: CommandStatus
  picked_at: string | null
  done_at: string | null
  result: AckMsg | null
}

// ------------------------------------------------------------ ESP32 메시지 (4.2)

interface Base extends Extra {
  t: string
  node?: string
  ms?: number | null
  /** Supabase가 붙인 시각 (COM-08) */
  created_at: string
}

/** 주기 측정값 (4.2 data) */
export interface DataMsg extends Base {
  t: 'data'
  node: string
  seq?: number | null
  sht_a_ok?: Bit | null
  temp_a?: number | null
  rh_a?: number | null
  sht_b_ok?: Bit | null
  temp_b?: number | null
  rh_b?: number | null
  soil_a_mv?: number | null
  soil_a?: number | null
  soil_b_mv?: number | null
  soil_b?: number | null
  hx_ok?: Bit | null
  weight_g?: number | null
  weight_sd?: number | null
  weight_raw?: number | null
  v12?: number | null
  leak?: Bit | null
  pump?: Bit | null
  rssi?: number | null
}

export type PumpReason =
  | 'done'
  | 'stop'
  | 'no_12v'
  | 'leak'
  | 'reboot'
  | 'already_on'
  | 'bad_ms'
  | 'cooldown'
  | 'bad_ml'
  | 'daily_limit'
  | 'flow_uncal'
  | 'scale_dead'
  | (string & {})

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

/** 명령 응답 (4.2 ack). commands.result 에 들어간다 */
export interface AckMsg extends Extra {
  t?: 'ack'
  node?: string
  ms?: number
  cmd: string
  ok: Bit
  msg: string
}

/** 설정·보정 상태 (4.2 info). nodes.info 에 들어간다 */
export interface InfoMsg extends Extra {
  t?: 'info'
  fw?: string
  sample_ms?: number
  soil_cal?: Bit
  soil_a_cal?: Bit
  soil_b_cal?: Bit
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
  cloud?: Bit
  day_ml?: number
  day_limit_ml?: number
  max_ml?: number
  sensor_a?: string
  sht_a_present?: Bit
  sht_b_present?: Bit
  soil_a_present?: Bit
  soil_b_present?: Bit
  hx_present?: Bit
  pump_present?: Bit
}

// ------------------------------------------------------------ 진단 (6.2, 진단 서버가 diagnostics 표에 쓴다)

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
  values?: Record<string, unknown> | null
}

// ------------------------------------------------------------ 화면이 쓰는 구역 상태 (Supabase 행에서 만든다)

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
  /** 이 보드에 달려 있는지 (info의 *_present). 모르면 true */
  present: boolean
}

export interface NodeState {
  node: NodeId
  online: boolean
  last_seen: string | null
  status: Severity
  latest: DataMsg | null
  info: InfoMsg | null
  pump: PumpState
  sensors: Record<SensorKey, SensorState>
  diagnostics: Diagnostic[]
}

/** 진단 서버가 만든 급수 결과 사건 (events.t = water_result) */
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
