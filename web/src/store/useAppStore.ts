import { create } from 'zustand'
import { buildNode, emptyParts, parseTs, toDataMsg, type NodeParts } from '@/lib/nodeState'
import type {
  DataMsg,
  Diagnostic,
  EventRow,
  NodeId,
  NodeRow,
  NodeState,
  PumpState,
  ReadingRow,
  WaterResult,
} from '@/types/api'

// 8시간 켜 두어도 메모리가 늘지 않게 목록 길이를 제한한다 (NFR-03)
export const MAX_RECENT = 120
export const MAX_EVENTS = 200

export type Conn = 'connecting' | 'open' | 'closed'

/** 화면에서 바로 쓰는 사건 (events 표 한 줄) */
export type LiveEvent = {
  id: string
  node: NodeId | null
  ts: number // 초 (Supabase 시각)
  time: string
  kind: 'evt' | 'water_result' | 'mark' | 'diag_on' | 'diag_off'
  payload: Record<string, unknown>
}

export type PumpProgress = { start: number; dur: number; ml?: number | null }

/** 처음 불러오는 것 (lib/live.ts) */
export type Snapshot = {
  nodes: NodeRow[]
  latest: ReadingRow[]
  recent: ReadingRow[]
  events: EventRow[] // 새것이 앞
  diagnostics: Diagnostic[]
}

type Store = {
  conn: Conn
  connChangedAt: number
  everOpened: boolean
  configError: string | null
  lastMessageAt: number | null
  clockOffsetMs: number // Supabase 시계 - 이 기기 시계
  parts: Record<NodeId, NodeParts> // Supabase에서 받은 그대로
  nodes: Record<NodeId, NodeState> // parts로 만든 화면용 상태
  recent: Record<NodeId, DataMsg[]> // 그래프용 최근 120개
  events: LiveEvent[] // 최근 200개, 새것이 앞
  pumpProgress: Record<NodeId, PumpProgress | null>
  lastWater: Record<NodeId, WaterResult>
  seenFaults: Set<string> // 섬 tall 알림을 본 진단 (code+node+since)
  beat: number // 측정값을 받을 때마다 +1 (살아 있음 점)

  setConn: (c: Conn) => void
  setConfigError: (msg: string | null) => void
  loadSnapshot: (s: Snapshot) => void
  addReading: (row: ReadingRow, receivedAt?: number) => void
  setNodeRow: (row: NodeRow) => void
  addEvent: (row: EventRow) => void
  setDiagnostics: (list: Diagnostic[]) => void
  refreshOnline: () => void
  markFaultSeen: (key: string) => void
}

export const diagKey = (d: Pick<Diagnostic, 'code' | 'node' | 'since'> & { sensor?: string }) =>
  `${d.node}:${d.code}:${d.sensor ?? ''}:${d.since}`

function progressFromPump(p: PumpState): PumpProgress | null {
  if (!p.on || !p.started_at || !p.dur) return null
  return { start: parseTs(p.started_at), dur: p.dur, ml: p.ml }
}

function pushCapped<T>(list: T[], item: T, max: number, front = true): T[] {
  const next = front ? [item, ...list] : [...list, item]
  if (next.length <= max) return next
  return front ? next.slice(0, max) : next.slice(next.length - max)
}

const LIVE_KINDS = new Set<string>(['evt', 'water_result', 'mark', 'diag_on', 'diag_off'])

function toLiveEvent(row: EventRow): LiveEvent | null {
  if (!LIVE_KINDS.has(row.t)) return null
  return {
    id: `ev-${row.id}`,
    node: row.node,
    ts: parseTs(row.created_at) / 1000,
    time: row.created_at,
    kind: row.t as LiveEvent['kind'],
    payload: { ...row.payload, ev: row.ev },
  }
}

/** 사건 하나를 구역 parts에 반영 (펌프 켜짐·꺼짐, info) */
function applyEvent(p: NodeParts, row: EventRow): NodeParts {
  if (row.t === 'evt' && row.ev === 'pump_on') return { ...p, pumpOn: row }
  if (row.t === 'evt' && row.ev === 'pump_off') return { ...p, pumpOff: row }
  if (row.t === 'info' && p.row) return { ...p, row: { ...p.row, info: row.payload } }
  return p
}

const newer = (a: { created_at: string } | null, b: { created_at: string }) =>
  !a || parseTs(b.created_at) >= parseTs(a.created_at)

/** parts 전체로 화면용 nodes·pumpProgress를 다시 만든다 */
function derive(parts: Record<NodeId, NodeParts>, clockOffsetMs: number) {
  const now = Date.now() + clockOffsetMs
  const nodes: Record<NodeId, NodeState> = {}
  const pumpProgress: Record<NodeId, PumpProgress | null> = {}
  for (const [id, p] of Object.entries(parts)) {
    nodes[id] = buildNode(id, p, now)
    pumpProgress[id] = progressFromPump(nodes[id].pump)
  }
  return { nodes, pumpProgress }
}

// 시계 차이: (Supabase가 붙인 시각 - 받은 시각) 중 최근 10개의 최댓값. 전송 지연은 차이를 작게만 만들므로 최댓값이 가장 가깝다
const offsetSamples: number[] = []

export const useAppStore = create<Store>((set) => ({
  conn: 'connecting',
  connChangedAt: Date.now(),
  everOpened: false,
  configError: null,
  lastMessageAt: null,
  clockOffsetMs: 0,
  parts: {},
  nodes: {},
  recent: {},
  events: [],
  pumpProgress: {},
  lastWater: {},
  seenFaults: new Set(),
  beat: 0,

  setConn: (conn) =>
    set((s) =>
      s.conn === conn ? s : { conn, connChangedAt: Date.now(), everOpened: s.everOpened || conn === 'open' },
    ),

  setConfigError: (configError) => set({ configError }),

  loadSnapshot: (snap) =>
    set((s) => {
      const parts: Record<NodeId, NodeParts> = {}
      const get = (id: NodeId) => (parts[id] ??= { ...emptyParts(), diagnostics: [] })
      for (const row of snap.nodes) get(row.node).row = row
      for (const r of snap.latest) get(r.node).reading = r
      for (const row of [...snap.events].reverse()) if (row.node) parts[row.node] = applyEvent(get(row.node), row)
      for (const d of snap.diagnostics) get(d.node).diagnostics.push(d)

      const recent: Record<NodeId, DataMsg[]> = {}
      for (const r of snap.recent) recent[r.node] = pushCapped(recent[r.node] ?? [], toDataMsg(r), MAX_RECENT, false)

      const lastWater: Record<NodeId, WaterResult> = {}
      for (const row of [...snap.events].reverse()) {
        if (row.t === 'water_result' && row.node) lastWater[row.node] = row.payload as WaterResult
      }
      const events = snap.events.map(toLiveEvent).filter((e): e is LiveEvent => e !== null)
      return { parts, recent, lastWater, events, lastMessageAt: Date.now(), ...derive(parts, s.clockOffsetMs) }
    }),

  addReading: (row, receivedAt) =>
    set((s) => {
      const prev = s.parts[row.node] ?? emptyParts()
      if (prev.reading && !newer(prev.reading, row)) return s // 이미 받은 것보다 오래됨
      let clockOffsetMs = s.clockOffsetMs
      if (receivedAt !== undefined) {
        const sample = parseTs(row.created_at) - receivedAt
        if (Number.isFinite(sample)) {
          offsetSamples.push(sample)
          if (offsetSamples.length > 10) offsetSamples.shift()
          clockOffsetMs = Math.max(...offsetSamples)
        }
      }
      const parts = { ...s.parts, [row.node]: { ...prev, reading: row } }
      const list = s.recent[row.node] ?? []
      const recent =
        list.at(-1)?.created_at === row.created_at
          ? s.recent
          : { ...s.recent, [row.node]: pushCapped(list, toDataMsg(row), MAX_RECENT, false) }
      return {
        parts,
        recent,
        clockOffsetMs,
        lastMessageAt: Date.now(),
        beat: s.beat + 1,
        ...derive(parts, clockOffsetMs),
      }
    }),

  setNodeRow: (row) =>
    set((s) => {
      const prev = s.parts[row.node] ?? emptyParts()
      const parts = { ...s.parts, [row.node]: { ...prev, row } }
      return { parts, ...derive(parts, s.clockOffsetMs) }
    }),

  addEvent: (row) =>
    set((s) => {
      const next: Partial<Store> = { lastMessageAt: Date.now() }
      const live = toLiveEvent(row)
      if (live && !s.events.some((e) => e.id === live.id)) next.events = pushCapped(s.events, live, MAX_EVENTS)
      if (row.t === 'water_result' && row.node)
        next.lastWater = { ...s.lastWater, [row.node]: row.payload as WaterResult }
      if (row.node) {
        const parts = { ...s.parts, [row.node]: applyEvent(s.parts[row.node] ?? emptyParts(), row) }
        Object.assign(next, { parts }, derive(parts, s.clockOffsetMs))
      }
      return next
    }),

  setDiagnostics: (list) =>
    set((s) => {
      const parts: Record<NodeId, NodeParts> = {}
      for (const [id, p] of Object.entries(s.parts)) parts[id] = { ...p, diagnostics: [] }
      for (const d of list) (parts[d.node] ??= emptyParts()).diagnostics.push(d)
      return { parts, ...derive(parts, s.clockOffsetMs) }
    }),

  // 1초마다: 시간이 지나 끊김·급수 끝이 바뀐 구역만 다시 그린다
  refreshOnline: () =>
    set((s) => {
      const d = derive(s.parts, s.clockOffsetMs)
      const changed = Object.keys(d.nodes).some(
        (id) => d.nodes[id].online !== s.nodes[id]?.online || d.nodes[id].pump.on !== s.nodes[id]?.pump.on,
      )
      return changed ? d : s
    }),

  markFaultSeen: (key) =>
    set((s) => {
      if (s.seenFaults.has(key)) return s
      const next = new Set(s.seenFaults)
      next.add(key)
      // 오래된 것은 버린다
      if (next.size > 200) next.delete(next.values().next().value as string)
      return { seenFaults: next }
    }),
}))

// 개발 중에는 브라우저 개발자 도구에서 window.__chamgap.getState() 로 본다
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __chamgap: typeof useAppStore }).__chamgap = useAppStore
}
