/** 숫자·시간 표시 형식. 값이 없으면 "--" */

const DASH = '--'

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 1234.5 → "1,234.5" (소수 자리 고정) */
export function formatFixed(value: number, decimals: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** 온도: 소수 1자리 °C */
export const fmtTemp = (v: number | null | undefined, unit = true) =>
  ok(v) ? `${v.toFixed(1)}${unit ? '°C' : ''}` : DASH

/** 습도: 정수 % */
export const fmtRh = (v: number | null | undefined, unit = true) =>
  ok(v) ? `${Math.round(v)}${unit ? '%' : ''}` : DASH

/** 토양 수분 지수 0~1: 소수 2자리 */
export const fmtSoil = (v: number | null | undefined) => (ok(v) ? v.toFixed(2) : DASH)

/** 무게: 천 단위 쉼표 + 소수 1자리 g */
export const fmtWeight = (v: number | null | undefined, unit = true) =>
  ok(v) ? `${formatFixed(v, 1)}${unit ? ' g' : ''}` : DASH

/** 전압 */
export const fmtVolt = (v: number | null | undefined) => (ok(v) ? `${v.toFixed(1)} V` : DASH)

/** mL: 정수면 정수, 아니면 소수 1자리 */
export const fmtMl = (v: number | null | undefined, unit = true) =>
  ok(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ? ' mL' : ''}` : DASH

/** 부호 있는 g: +9.6g */
export const fmtDeltaG = (v: number | null | undefined) => (ok(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}g` : DASH)

const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' })

/** "3초 전", "2분 전", "1시간 전" (now는 서버 시계 기준 ms) */
export function fmtAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return DASH
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return DASH
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return rtf.format(-s, 'second')
  const m = Math.floor(s / 60)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.floor(m / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  return rtf.format(-Math.floor(h / 24), 'day')
}

/** 경과: "45초", "3분", "1시간 20분" */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  return `${h}시간${m % 60 ? ` ${m % 60}분` : ''}`
}

/** 30초가 넘은 값인가 (UI-08) */
export function isStale(iso: string | null | undefined, now: number, limitMs = 30_000): boolean {
  if (!iso) return true
  const t = Date.parse(iso)
  return Number.isNaN(t) || now - t > limitMs
}

/** 14:02 */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}
