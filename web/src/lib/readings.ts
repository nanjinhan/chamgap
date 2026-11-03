import type { DataMsg, NodeState, SensorKey, Severity } from '@/types/api'

/**
 * 화면에 보여 줄 값과 상태. 디자인처럼 온도·습도·토양은 A(대상)·B(비교) 평균을 큰 숫자로 보이고,
 * A·B 각각은 상세 화면에서 따로 보인다. 상태는 데이터가 말하는 것만 (lib/nodeState.ts).
 */

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** A·B 중 있는 값의 평균 (둘 다 없으면 null) */
export function avgAB(a: unknown, b: unknown): number | null {
  const xs = [a, b].filter(isNum)
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
}

export type Kind = 'climate' | 'soil' | 'weight'

export function values(d: DataMsg | null | undefined) {
  return {
    temp: avgAB(d?.temp_a, d?.temp_b),
    rh: avgAB(d?.rh_a, d?.rh_b),
    soil: avgAB(d?.soil_a, d?.soil_b),
    weightG: isNum(d?.weight_g) ? d.weight_g : null,
  }
}

const KIND_SENSORS: Record<Kind, SensorKey[]> = {
  climate: ['sht_a', 'sht_b'],
  soil: ['soil_a', 'soil_b'],
  weight: ['scale'],
}

const ORDER: Severity[] = ['ok', 'info', 'warn', 'fault', 'offline']

/** 센서 하나의 상태와 글자: 미설치 · 끊김 · 고장 · 주의 · 보정 전 · 정상 */
export function sensorState(
  node: NodeState | undefined,
  key: SensorKey,
): { status: Severity; text: string; present: boolean } {
  if (!node) return { status: 'offline', text: '신호 없음', present: true }
  const s = node.sensors[key]
  if (!s.present) return { status: 'offline', text: '미설치', present: false }
  if (!node.online) return { status: 'offline', text: '끊김', present: true }
  const text = { ok: '정상', info: '보정 전', warn: '주의', fault: '고장', offline: '끊김' }[s.status]
  return { status: s.status, text, present: true }
}

/** 화면 묶음(온습도·토양·무게)의 상태: 달린 센서 중 가장 나쁜 것 */
export function kindState(
  node: NodeState | undefined,
  kind: Kind,
): { status: Severity; text: string; present: boolean } {
  const list = KIND_SENSORS[kind].map((k) => sensorState(node, k))
  const present = list.filter((x) => x.present)
  if (!present.length) return { status: 'offline', text: '미설치', present: false }
  return present.reduce((a, b) => (ORDER.indexOf(b.status) > ORDER.indexOf(a.status) ? b : a))
}

export const fmt = {
  temp: (v: number | null) => (v == null ? '--' : `${v.toFixed(1)}°`),
  rh: (v: number | null) => (v == null ? '--' : `${Math.round(v)}%`),
  soil: (v: number | null) => (v == null ? '--' : v.toFixed(2)),
  grams: (v: number | null) => (v == null ? '--' : Math.round(v).toLocaleString('en-US')),
  kg: (v: number | null) => (v == null ? '--' : (v / 1000).toFixed(2)),
  ml: (v: number | null) => (v == null ? '--' : Number.isInteger(v) ? String(v) : v.toFixed(1)),
}
