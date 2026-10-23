import { create } from 'zustand'
import type {
  AppState,
  DataMsg,
  Diagnostic,
  EvtMsg,
  LinkStatus,
  LogPayload,
  NodeId,
  NodeState,
  PumpState,
  TestMsg,
  WaterResult,
  WsMessage,
} from '@/types/api'

// 8시간 켜 두어도 메모리가 늘지 않게 목록 길이를 제한한다 (NFR-02)
export const MAX_RECENT = 120
export const MAX_EVENTS = 200
export const MAX_TEST_LOG = 300

export type Conn = 'connecting' | 'open' | 'closed'

/** 화면에서 바로 쓰는 사건 (서버 /api/events와 같은 모양) */
export type LiveEvent = {
  id: string
  node: NodeId | null
  ts: number // 초 (서버 시계)
  time: string
  kind: 'evt' | 'water_result' | 'mark' | 'diag_on' | 'diag_off' | 'link'
  payload: Record<string, unknown>
}

export type TestLine =
  | { id: number; kind: 'log'; time: string; src: string | null; text: string; note: boolean; dir: 'rx' | 'tx' }
  | { id: number; kind: 'json'; time: string; src: string | null; t: string; data: TestMsg }

export type PumpProgress = { start: number; dur: number; ml?: number | null }

type Store = {
  conn: Conn
  connChangedAt: number
  everOpened: boolean
  lastMessageAt: number | null
  clockOffsetMs: number // 서버 시계 - 이 기기 시계
  link: LinkStatus | null
  nodes: Record<NodeId, NodeState>
  recent: Record<NodeId, DataMsg[]> // 그래프용 최근 120개
  events: LiveEvent[] // 최근 200개, 새것이 앞
  testLog: TestLine[] // 시험 모드, 최근 300줄
  lastTest: Record<string, TestMsg> // 경로별 마지막 시험 메시지
  pumpProgress: Record<NodeId, PumpProgress | null>
  lastWater: Record<NodeId, WaterResult>
  seenFaults: Set<string> // 섬 tall 알림을 본 진단 (code+node+since)
  beat: number // data를 받을 때마다 +1 (살아 있음 점)

  setConn: (c: Conn) => void
  apply: (msg: WsMessage) => void
  markFaultSeen: (key: string) => void
}

let seq = 0

const emptyPump: PumpState = {
  on: false,
  started_at: null,
  dur: null,
  ml: null,
  last_ml: null,
  last_at: null,
  today_ml: 0,
}

function blankNode(node: NodeId): NodeState {
  return {
    node,
    src: null,
    online: true,
    last_seen: null,
    status: 'ok',
    latest: null,
    info: null,
    pump: emptyPump,
    sensors: {
      sht_a: { status: 'ok', value: null },
      sht_b: { status: 'ok', value: null },
      soil_a: { status: 'ok', value: null },
      soil_b: { status: 'ok', value: null },
      scale: { status: 'ok', value: null },
      pump: { status: 'ok', value: null },
      power: { status: 'ok', value: null },
    },
    diagnostics: [],
  }
}

export const diagKey = (d: Pick<Diagnostic, 'code' | 'node' | 'since'> & { sensor?: string }) =>
  `${d.node}:${d.code}:${d.sensor ?? ''}:${d.since}`

function progressFromPump(p: PumpState): PumpProgress | null {
  if (!p.on || !p.started_at || !p.dur) return null
  return { start: Date.parse(p.started_at), dur: p.dur, ml: p.ml }
}

function liveEvent(kind: LiveEvent['kind'], node: NodeId | null, payload: Record<string, unknown>, time?: string) {
  const t = time && !Number.isNaN(Date.parse(time)) ? time : new Date().toISOString()
  return { id: `live-${++seq}`, node, ts: Date.parse(t) / 1000, time: t, kind, payload } satisfies LiveEvent
}

function pushCapped<T>(list: T[], item: T, max: number, front = true): T[] {
  const next = front ? [item, ...list] : [...list, item]
  if (next.length <= max) return next
  return front ? next.slice(0, max) : next.slice(next.length - max)
}

/** 진단 목록이 바뀐 것을 사건으로 (화면용. 서버도 events에 기록한다) */
function diagChanges(node: NodeId, before: Diagnostic[], after: Diagnostic[], time: string): LiveEvent[] {
  const k = (d: Diagnostic) => `${d.code}:${d.sensor}`
  const prev = new Map(before.map((d) => [k(d), d]))
  const next = new Map(after.map((d) => [k(d), d]))
  const out: LiveEvent[] = []
  for (const [key, d] of next) {
    if (!prev.has(key)) out.push(liveEvent('diag_on', node, { ...d }, d.since || time))
  }
  for (const [key, d] of prev) {
    if (!next.has(key)) out.push(liveEvent('diag_off', node, { ...d }, time))
  }
  return out
}

export const useAppStore = create<Store>((set) => ({
  conn: 'connecting',
  connChangedAt: Date.now(),
  everOpened: false,
  lastMessageAt: null,
  clockOffsetMs: 0,
  link: null,
  nodes: {},
  recent: {},
  events: [],
  testLog: [],
  lastTest: {},
  pumpProgress: {},
  lastWater: {},
  seenFaults: new Set(),
  beat: 0,

  setConn: (conn) =>
    set((s) =>
      s.conn === conn ? s : { conn, connChangedAt: Date.now(), everOpened: s.everOpened || conn === 'open' },
    ),

  markFaultSeen: (key) =>
    set((s) => {
      if (s.seenFaults.has(key)) return s
      const next = new Set(s.seenFaults)
      next.add(key)
      // 오래된 것은 버린다
      if (next.size > 200) next.delete(next.values().next().value as string)
      return { seenFaults: next }
    }),

  apply: (msg) =>
    set((s) => {
      const now = Date.now()
      const base: Partial<Store> = { lastMessageAt: now }
      if ('server_time' in msg && msg.server_time) {
        const st = Date.parse(msg.server_time)
        if (!Number.isNaN(st)) base.clockOffsetMs = st - now
      }
      switch (msg.type) {
        case 'ping':
          return base

        case 'snapshot': {
          const st: AppState = msg.state
          const pumpProgress: Record<NodeId, PumpProgress | null> = {}
          const recent: Record<NodeId, DataMsg[]> = { ...s.recent }
          for (const [id, n] of Object.entries(st.nodes)) {
            pumpProgress[id] = progressFromPump(n.pump)
            if (n.latest && !(recent[id] ?? []).some((d) => d.pc_time === n.latest?.pc_time)) {
              recent[id] = pushCapped(recent[id] ?? [], n.latest, MAX_RECENT, false)
            }
          }
          return { ...base, nodes: st.nodes, link: st.link, pumpProgress, recent }
        }

        case 'data': {
          const id = msg.node
          const prev = s.nodes[id] ?? blankNode(id)
          const node: NodeState = {
            ...prev,
            latest: msg.payload,
            last_seen: msg.last_seen ?? msg.payload.pc_time,
            online: msg.online ?? true,
          }
          return {
            ...base,
            nodes: { ...s.nodes, [id]: node },
            recent: { ...s.recent, [id]: pushCapped(s.recent[id] ?? [], msg.payload, MAX_RECENT, false) },
            beat: s.beat + 1,
          }
        }

        case 'evt': {
          const id = msg.node
          const p = msg.payload
          if (!id) return base
          const prev = s.nodes[id] ?? blankNode(id)
          if (p.t === 'water_result') {
            const w = p as WaterResult
            return {
              ...base,
              lastWater: { ...s.lastWater, [id]: w },
              events: pushCapped(s.events, liveEvent('water_result', id, { ...w }), MAX_EVENTS),
            }
          }
          if (p.t === 'mark') {
            return { ...base, events: pushCapped(s.events, liveEvent('mark', id, { ...p }, p.pc_time), MAX_EVENTS) }
          }
          if (p.t === 'info') {
            return { ...base, nodes: { ...s.nodes, [id]: { ...prev, info: msg.info ?? prev.info } } }
          }
          const e = p as EvtMsg
          const pump = msg.pump ?? prev.pump
          const next: Partial<Store> = {
            ...base,
            nodes: { ...s.nodes, [id]: { ...prev, pump } },
            events: pushCapped(s.events, liveEvent('evt', id, { ...e }, e.pc_time), MAX_EVENTS),
          }
          if (e.ev === 'pump_on') {
            next.pumpProgress = {
              ...s.pumpProgress,
              [id]: { start: Date.parse(e.pc_time), dur: Number(e.dur ?? 0), ml: e.ml ?? null },
            }
          } else if (e.ev === 'pump_off' || e.ev === 'boot') {
            next.pumpProgress = { ...s.pumpProgress, [id]: null }
          }
          return next
        }

        case 'ack':
          return base

        case 'diag': {
          const id = msg.node
          const prev = s.nodes[id] ?? blankNode(id)
          const time = msg.server_time ?? new Date().toISOString()
          const changes = diagChanges(id, prev.diagnostics, msg.payload.diagnostics, time)
          let events = s.events
          for (const ev of changes) events = pushCapped(events, ev, MAX_EVENTS)
          return {
            ...base,
            events,
            nodes: {
              ...s.nodes,
              [id]: {
                ...prev,
                diagnostics: msg.payload.diagnostics,
                status: msg.payload.status,
                sensors: msg.payload.sensors,
                online: msg.payload.online,
              },
            },
          }
        }

        case 'link': {
          const p = msg.payload
          const next: Partial<Store> = { ...base, link: p.link ?? s.link }
          const id = msg.node
          if (id && (p.event === 'node_online' || p.event === 'node_offline')) {
            const prev = s.nodes[id] ?? blankNode(id)
            next.nodes = { ...s.nodes, [id]: { ...prev, online: p.event === 'node_online' } }
            next.events = pushCapped(s.events, liveEvent('link', id, { ...p, link: undefined }), MAX_EVENTS)
          }
          return next
        }

        case 'log': {
          const p: LogPayload = msg.payload
          const line: TestLine = {
            id: ++seq,
            kind: 'log',
            time: p.pc_time,
            src: p.src,
            text: p.text,
            note: p.note,
            dir: p.dir,
          }
          return { ...base, testLog: pushCapped(s.testLog, line, MAX_TEST_LOG, false) }
        }

        case 'test': {
          const p = msg.payload
          const line: TestLine = { id: ++seq, kind: 'json', time: p.pc_time, src: p.src ?? null, t: p.t, data: p }
          return {
            ...base,
            testLog: pushCapped(s.testLog, line, MAX_TEST_LOG, false),
            lastTest: { ...s.lastTest, [p.src ?? '']: p },
          }
        }

        default:
          return base
      }
    }),
}))

// 개발 중에는 브라우저 개발자 도구에서 window.__chamgap.getState() 로 본다
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __chamgap: typeof useAppStore }).__chamgap = useAppStore
}
