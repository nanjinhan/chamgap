import { useEffect, useState } from 'react'
import type { Metric, NodeId } from '@/types/api'
import { parseTs } from './nodeState'
import { supabase } from './supabase'

/**
 * 그래프용 기록: Supabase history() 함수(bucket 초 평균, 최대 14일)를 부른다.
 * 날짜·시각은 한국 시간(KST) 기준으로 나눈다.
 */

export type HistRow = { t: number } & Partial<Record<Metric | 'weight_raw', number | null>>

const KST = 9 * 3_600_000
const DAY = 86_400_000

/** 한국 날짜 'YYYY-MM-DD' */
export const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10)
/** 그 날 한국 0시 (ms) */
export const kstMidnight = (ms: number) => Math.floor((ms + KST) / DAY) * DAY - KST
/** 'MM.DD' */
export const md = (day: string) => day.slice(5).replace('-', '.')
/** 'HH:MM' (한국) */
export const hm = (ms: number) => new Date(ms + KST).toISOString().slice(11, 16)

export function useHistory(node: NodeId | undefined, minutes: number, bucketS: number, refreshMs = 60_000) {
  const [rows, setRows] = useState<HistRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!node || !supabase) return
    const db = supabase
    let alive = true
    const load = async () => {
      const { data, error: err } = await db.rpc('history', {
        p_node: node,
        p_minutes: Math.max(1, Math.min(20_160, Math.round(minutes))),
        p_bucket_s: bucketS,
      })
      if (!alive) return
      if (err) {
        setError(err.message)
        return
      }
      setError(null)
      setRows(
        ((data ?? []) as ({ ts: string } & Record<string, number | null>)[]).map((r) => ({ ...r, t: parseTs(r.ts) })),
      )
    }
    void load()
    const id = setInterval(() => void load(), refreshMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [node, minutes, bucketS, refreshMs])
  return { rows, error }
}

/** A·B 평균 열을 더한다 (그래프 한 줄용) */
export function withAvg(
  rows: HistRow[],
  a: Metric,
  b: Metric,
  key: string,
): (HistRow & Record<string, number | null>)[] {
  return rows.map((r) => {
    const xs = [r[a], r[b]].filter((x): x is number => typeof x === 'number')
    return { ...r, [key]: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null }
  })
}

/** 하루 평균 (최근 days일, 오늘 포함). 값이 없는 날은 null */
export type DayRow = { day: string; label: string; [k: string]: string | number | null }

export function dailyAvg(rows: HistRow[], keys: string[], days: number, now: number): DayRow[] {
  const out: DayRow[] = []
  const today = kstMidnight(now)
  for (let i = days - 1; i >= 0; i--) {
    const start = today - i * DAY
    const day = kstDay(start)
    const inDay = rows.filter((r) => r.t >= start && r.t < start + DAY)
    const row: DayRow = { day, label: md(day) }
    for (const k of keys) {
      const xs = inDay.map((r) => (r as Record<string, unknown>)[k]).filter((x): x is number => typeof x === 'number')
      row[k] = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
    }
    out.push(row)
  }
  return out
}

/** 최저·최고(언제)·평균 */
export function stats<T extends { t?: number }>(rows: T[], key: string) {
  const pts = rows
    .map((r) => ({ t: r.t ?? 0, v: (r as Record<string, unknown>)[key] }))
    .filter((p): p is { t: number; v: number } => typeof p.v === 'number')
  if (!pts.length) return null
  const min = pts.reduce((a, b) => (b.v < a.v ? b : a))
  const max = pts.reduce((a, b) => (b.v > a.v ? b : a))
  return { min, max, avg: pts.reduce((s, p) => s + p.v, 0) / pts.length }
}
