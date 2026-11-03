import type { RealtimeChannel } from '@supabase/supabase-js'
import { MAX_EVENTS, MAX_RECENT, useAppStore } from '@/store/useAppStore'
import type { CommandRow, Diagnostic, EventRow, NodeId, NodeRow, ReadingRow } from '@/types/api'
import { onCommandUpdate } from './commands'
import { parseTs } from './nodeState'
import { configError, supabase } from './supabase'

/**
 * Supabase 실시간 연결 하나를 앱 전체가 쓴다 (요구사항 4.4, UI-07).
 * - 시작·다시 연결될 때: 표를 한 번에 불러와 store를 통째로 바꾼다 (끊긴 동안 빠진 것 메우기)
 * - 그 뒤: Realtime으로 readings·events 새 줄, commands·diagnostics 변경을 받는다
 *   (nodes 표는 측정값마다 바뀌어 메시지가 2배가 되므로 구독하지 않고, info·펌프 사건이 오면 그 구역만 다시 읽는다)
 * - 15초마다 구역별 마지막 값을 조회해, Realtime이 조용히 끊겼으면 다시 연결한다
 */

const RECENT_MINUTES = 10
const CHECK_MS = 15_000

let channel: RealtimeChannel | null = null
let started = false
let loading = false
let closedSince: number | null = null
const nodeTimers = new Map<NodeId, ReturnType<typeof setTimeout>>()

const store = () => useAppStore.getState()

async function loadSnapshot() {
  if (!supabase || loading) return
  loading = true
  try {
    const since = new Date(Date.now() + store().clockOffsetMs - RECENT_MINUTES * 60_000).toISOString()
    const [nodes, latest, recent, events, diagnostics] = await Promise.all([
      supabase.from('nodes').select('*').returns<NodeRow[]>(),
      supabase.from('latest_readings').select('*').returns<ReadingRow[]>(),
      supabase
        .from('readings')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(MAX_RECENT * 3)
        .returns<ReadingRow[]>(),
      supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_EVENTS)
        .returns<EventRow[]>(),
      supabase.from('diagnostics').select('*').returns<Diagnostic[]>(),
    ])
    const failed = [nodes, latest, recent, events, diagnostics].find((r) => r.error)
    if (failed?.error) throw failed.error
    store().loadSnapshot({
      nodes: nodes.data ?? [],
      latest: latest.data ?? [],
      recent: [...(recent.data ?? [])].reverse(),
      events: events.data ?? [],
      diagnostics: diagnostics.data ?? [],
    })
  } catch (e) {
    console.warn('[live] 불러오기 실패', e)
  } finally {
    loading = false
  }
}

/** 구역 하나의 nodes 행을 다시 읽는다 (사건이 몰려 와도 한 번만) */
function refetchNode(node: NodeId) {
  if (!supabase || nodeTimers.has(node)) return
  nodeTimers.set(
    node,
    setTimeout(async () => {
      nodeTimers.delete(node)
      const { data } = await supabase!.from('nodes').select('*').eq('node', node).maybeSingle<NodeRow>()
      if (data) store().setNodeRow(data)
    }, 400),
  )
}

async function refetchDiagnostics() {
  if (!supabase) return
  const { data } = await supabase.from('diagnostics').select('*').returns<Diagnostic[]>()
  if (data) store().setDiagnostics(data)
}

function subscribe() {
  if (!supabase) return
  if (channel) void supabase.removeChannel(channel)
  channel = supabase
    .channel('chamgap-web')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings' }, (p) =>
      store().addReading(p.new as ReadingRow, Date.now()),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => {
      const row = p.new as EventRow
      store().addEvent(row)
      if (row.node && (row.t === 'info' || row.ev === 'pump_on' || row.ev === 'pump_off' || row.ev === 'boot')) {
        refetchNode(row.node)
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'commands' }, (p) =>
      onCommandUpdate(p.new as CommandRow),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'diagnostics' }, () => void refetchDiagnostics())
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        closedSince = null
        store().setConn('open')
        void loadSnapshot() // 끊긴 동안 빠진 것 메우기
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        closedSince ??= Date.now()
        store().setConn('closed')
      }
    })
}

/** 15초마다: 구역별 마지막 값이 store보다 새로우면 Realtime이 놓친 것 → 반영하고 다시 연결 */
async function check() {
  if (!supabase || document.hidden) return
  if (closedSince && Date.now() - closedSince > 30_000) {
    closedSince = Date.now()
    subscribe() // 라이브러리의 자동 재연결이 오래 안 되면 새로 연결
    return
  }
  const { data } = await supabase.from('latest_readings').select('*').returns<ReadingRow[]>()
  if (!data) return
  let missed = false
  const now = Date.now() + store().clockOffsetMs
  for (const row of data) {
    const have = store().parts[row.node]?.reading
    const at = parseTs(row.created_at)
    if (!have || at > parseTs(have.created_at)) {
      store().addReading(row)
      if (now - at > 4_000) missed = true // 방금 들어온 줄은 Realtime이 곧 줄 수 있으니 4초 넘은 것만
    }
  }
  if (missed && store().conn === 'open' && store().everOpened) subscribe()
}

/** 앱 시작 때 한 번 (main.tsx) */
export function startConnection() {
  if (started) return
  started = true
  if (configError || !supabase) {
    store().setConfigError(configError)
    store().setConn('closed')
    return
  }
  void loadSnapshot()
  subscribe()
  setInterval(() => store().refreshOnline(), 1_000)
  setInterval(() => void check(), CHECK_MS)
  // 폰 화면을 다시 켰을 때 기다리지 않고 바로 최신으로
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void loadSnapshot()
      if (store().conn !== 'open') subscribe()
    }
  })
}
