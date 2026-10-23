import { toast } from '@/store/useToasts'
import type {
  AckMsg,
  ApiErrorBody,
  AppState,
  Diagnostic,
  EventItem,
  FlowCalResult,
  HistoryResponse,
  LinkStatus,
  Metric,
  NodeId,
  NodeState,
  Preflight,
  PreflightCheck,
} from '@/types/api'

/**
 * REST 래퍼. 서버 주소는 쓰지 않고 항상 상대 경로(/api/...).
 * 오류 응답 {"ok":false,"error","message"}의 message를 그대로 토스트로 보여 준다.
 */

const PIN_KEY = 'chamgap-pin'

export function getPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY)
  } catch {
    return null
  }
}

export function setPin(pin: string | null) {
  try {
    if (pin) sessionStorage.setItem(PIN_KEY, pin)
    else sessionStorage.removeItem(PIN_KEY)
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 쓴다
  }
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly checks?: PreflightCheck[]
  readonly ack?: AckMsg | null

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message || '요청을 처리하지 못했어요')
    this.code = body.error || 'error'
    this.status = status
    this.checks = body.checks
    this.ack = body.ack
  }
}

type Opts = { quiet?: boolean; signal?: AbortSignal }

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const pin = getPin()
  if (pin) headers['X-Chamgap-Pin'] = pin
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    const err = new ApiError(0, { error: 'network', message: '서버에 연결할 수 없어요' })
    if (!opts.quiet) toast.error(err.message)
    throw err
  }
  const data: unknown = await res.json().catch(() => null) // 빈 응답·HTML 오류 페이지는 null
  const failed = !res.ok || (typeof data === 'object' && data !== null && (data as { ok?: unknown }).ok === false)
  if (failed) {
    const err = new ApiError(res.status, (data ?? {}) as Partial<ApiErrorBody>)
    if (!opts.quiet) toast.error(err.message)
    throw err
  }
  return data as T
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

const enc = encodeURIComponent

type AckResponse = { ok: true; ack: AckMsg | null }
type StopAllResponse = {
  ok: boolean
  results: Record<NodeId, { ok: boolean; error?: string; message?: string }>
  unknown_ports: string[]
}

export const api = {
  state: (o?: Opts) => request<AppState>('GET', '/api/state', undefined, o),
  link: (o?: Opts) => request<LinkStatus>('GET', '/api/link', undefined, o),
  node: (node: NodeId, o?: Opts) =>
    request<NodeState & { recent: unknown[] }>('GET', `/api/nodes/${enc(node)}`, undefined, o),
  diagnostics: (o?: Opts) => request<{ ok: true; diagnostics: Diagnostic[] }>('GET', '/api/diagnostics', undefined, o),
  history: (node: NodeId, metrics: Metric[], minutes: number, bucket: number, o?: Opts) =>
    request<HistoryResponse>(
      'GET',
      `/api/history${q({ node, metric: metrics.join(','), minutes, bucket })}`,
      undefined,
      o,
    ),
  events: (p: { node?: NodeId; limit?: number; kind?: string; minutes?: number }, o?: Opts) =>
    request<{ ok: true; events: EventItem[] }>('GET', `/api/events${q(p)}`, undefined, o),

  preflight: (node: NodeId, ml: number, o?: Opts) =>
    request<Preflight>('GET', `/api/nodes/${enc(node)}/water/preflight${q({ ml })}`, undefined, { quiet: true, ...o }),
  water: (node: NodeId, ml: number) => request<AckResponse>('POST', `/api/nodes/${enc(node)}/water`, { ml }),
  stop: (node: NodeId) => request<AckResponse>('POST', `/api/nodes/${enc(node)}/stop`),
  stopAll: () => request<StopAllResponse>('POST', '/api/stop-all'),
  command: (node: NodeId, cmd: string) => request<AckResponse>('POST', `/api/nodes/${enc(node)}/command`, { cmd }),
  flowCalRun: (node: NodeId, ms: number) =>
    request<FlowCalResult>('POST', `/api/nodes/${enc(node)}/flow-cal/run`, { ms }),
  mark: (node: NodeId | null, note: string) => request<{ ok: true }>('POST', '/api/mark', { node, note }),
  raw: (src: string | null, text: string) => request<{ ok: true }>('POST', '/api/raw', { src, text }),
  reloadDiagnostics: () => request<{ ok: true; rules: number }>('POST', '/api/diagnostics/reload'),
  mockScenario: (node: NodeId, scenario: string) =>
    request<{ ok: true; expects: string[] }>('POST', '/api/mock/scenario', { node, scenario }),
  pinCheck: (pin: string) => request<{ ok: true }>('POST', '/api/pin/check', { pin }, { quiet: true }),

  /** 다운로드 링크 (브라우저가 바로 받는다) */
  exportCsvUrl: (node: NodeId | null, from?: string, to?: string) => `/api/export.csv${q({ node, from, to })}`,
}
