import type { AckMsg, CommandRow, CommandStatus, NodeId } from '@/types/api'
import { supabase } from './supabase'

/**
 * 명령: commands 표에 넣고(pending) → ESP32가 가져가(sent) → 결과를 적는다(done/failed).
 * 10초 안에 아무도 안 가져가면 Supabase가 expired로 바꾼다 (COM-12).
 * 결과는 Realtime(lib/live.ts → onCommandUpdate)으로 받고, 놓칠 때를 대비해 1.5초마다도 확인한다.
 */

export type CommandOutcome = {
  node: NodeId
  cmd: string
  id: number | null
  status: CommandStatus | 'timeout' | 'error'
  ok: boolean
  result: AckMsg | null
  /** 사람이 읽는 한 줄 */
  message: string
}

/** 펌웨어가 ack의 msg로 보내는 거부 이유 → 화면 문구 */
const REASON_KO: Record<string, string> = {
  already_on: '펌프가 이미 켜져 있어요',
  cooldown: '펌프가 잠깐 쉬는 중이에요 (3초)',
  bad_ml: '1~50mL만 줄 수 있어요',
  daily_limit: '오늘 급수 한도(300mL)를 넘어요',
  flow_uncal: '유량 보정이 먼저예요',
  bad_ms: '펌프 시간이 범위를 벗어났어요',
  no_12v: '12V 전원이 없어요 (비상정지·퓨즈 확인)',
  leak: '물이 새고 있어요',
  scale_dead: '무게 센서가 응답하지 않아요',
  busy: '다른 보정·급수가 진행 중이에요',
  no_pump: '이 구역에는 펌프가 없어요',
  lc_uncal: '로드셀 보정이 먼저예요',
  serial_only: '이 명령은 USB로만 보낼 수 있어요',
  unstable: '무게가 흔들려서 재지 못했어요',
  'not running': '펌프가 이미 꺼져 있었어요',
}

export function reasonText(msg: string | null | undefined): string {
  if (!msg) return ''
  return REASON_KO[msg] ?? msg
}

/** 결과를 기다리는 시간 (COM-10): 기본 10초, tare·cal 15초, flowcal은 ms + 70초 */
export function commandTimeoutMs(cmd: string): number {
  const [name, arg] = cmd.trim().toLowerCase().split(/\s+/)
  if (name === 'tare' || name === 'cal') return 15_000
  if (name === 'flowcal') return (Number(arg) || 0) + 70_000
  return 10_000
}

const TERMINAL: CommandStatus[] = ['done', 'failed', 'expired']
const waiters = new Map<number, (row: CommandRow) => void>()

/** Realtime으로 commands 행이 바뀌었을 때 (lib/live.ts가 부른다) */
export function onCommandUpdate(row: CommandRow) {
  waiters.get(row.id)?.(row)
}

function outcome(
  node: NodeId,
  cmd: string,
  id: number | null,
  row: CommandRow | null,
  why?: 'timeout',
): CommandOutcome {
  if (!row || why === 'timeout') {
    return { node, cmd, id, status: 'timeout', ok: false, result: null, message: `${node}: 응답이 없어요` }
  }
  const result = row.result
  if (row.status === 'done') {
    const note = result?.msg ? ` (${reasonText(result.msg)})` : ''
    return { node, cmd, id, status: 'done', ok: true, result, message: `${node}: 완료${note}` }
  }
  if (row.status === 'expired') {
    return { node, cmd, id, status: 'expired', ok: false, result, message: `${node}: 구역이 응답하지 않아 취소됐어요` }
  }
  return {
    node,
    cmd,
    id,
    status: row.status,
    ok: false,
    result,
    message: `${node}: ${reasonText(result?.msg) || '실패'}`,
  }
}

/** 이미 넣은 명령의 결과를 기다린다 */
export function waitCommand(node: NodeId, cmd: string, id: number, timeoutMs = commandTimeoutMs(cmd)) {
  return new Promise<CommandOutcome>((resolve) => {
    let finished = false
    const finish = (row: CommandRow | null, why?: 'timeout') => {
      if (finished) return
      finished = true
      waiters.delete(id)
      clearInterval(poll)
      clearTimeout(timer)
      resolve(outcome(node, cmd, id, row, why))
    }
    waiters.set(id, (row) => {
      if (TERMINAL.includes(row.status)) finish(row)
    })
    const poll = setInterval(async () => {
      if (!supabase) return
      const { data } = await supabase.from('commands').select('*').eq('id', id).maybeSingle<CommandRow>()
      if (data && TERMINAL.includes(data.status)) finish(data)
    }, 1500)
    const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs)
  })
}

function insertError(node: NodeId, cmd: string, code: string | undefined): CommandOutcome {
  const message = code === '23514' ? '보낼 수 없는 명령이에요' : '명령을 보내지 못했어요 (인터넷 연결 확인)'
  return { node, cmd, id: null, status: 'error', ok: false, result: null, message: `${node}: ${message}` }
}

/** 명령 하나를 보내고 결과까지 기다린다 */
export async function sendCommand(node: NodeId, cmd: string): Promise<CommandOutcome> {
  if (!supabase) return insertError(node, cmd, undefined)
  const { data, error } = await supabase.from('commands').insert({ node, cmd }).select('id').single<{ id: number }>()
  if (error || !data) return insertError(node, cmd, error?.code)
  return waitCommand(node, cmd, data.id)
}

/**
 * 모두 정지 (SAFE-06): 아는 구역 모두에 stop을 한 번에 넣는다.
 * 넣기만 하면 바로 돌아오고(sent), 결과는 results로 따로 기다린다.
 */
export async function stopAll(
  nodes: NodeId[],
): Promise<{ sent: boolean; message: string; results: Promise<CommandOutcome[]> }> {
  if (!supabase || nodes.length === 0) {
    return {
      sent: false,
      message: nodes.length === 0 ? '아직 연결된 구역이 없어요' : '정지를 보내지 못했어요',
      results: Promise.resolve([]),
    }
  }
  const { data, error } = await supabase
    .from('commands')
    .insert(nodes.map((node) => ({ node, cmd: 'stop' })))
    .select('id,node')
    .returns<{ id: number; node: NodeId }[]>()
  if (error || !data) {
    return { sent: false, message: '정지를 보내지 못했어요 (인터넷 연결 확인)', results: Promise.resolve([]) }
  }
  return {
    sent: true,
    message: `${nodes.length}구역에 정지를 보냈어요`,
    results: Promise.all(data.map((r) => waitCommand(r.node, 'stop', r.id))),
  }
}
