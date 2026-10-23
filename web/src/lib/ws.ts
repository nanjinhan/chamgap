import { useAppStore } from '@/store/useAppStore'
import type { WsMessage } from '@/types/api'

/**
 * 서버 WebSocket(/ws) 연결 하나를 앱 전체가 쓴다.
 * - 끊기면 1s → 2s → 4s … 최대 10s 간격으로 다시 접속
 * - 30초 동안 아무것도 못 받으면(ping 포함) 끊고 다시 접속
 * - 접속하면 서버가 snapshot을 보내 store를 통째로 바꾸고, 이후는 부분 갱신
 */

const MAX_BACKOFF_MS = 10_000
const SILENCE_MS = 30_000

let socket: WebSocket | null = null
let backoff = 1000
let retryTimer: ReturnType<typeof setTimeout> | null = null
let watchdog: ReturnType<typeof setInterval> | null = null
let lastMessage = 0
let started = false

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws` // 상대 경로: 개발 중엔 Vite가, 빌드 후엔 서버가 받는다
}

function scheduleRetry() {
  if (retryTimer || !started) return
  const wait = backoff
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    open()
  }, wait)
}

function open() {
  if (!started) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const store = useAppStore.getState()
  if (!store.everOpened) store.setConn('connecting')
  let ws: WebSocket
  try {
    ws = new WebSocket(wsUrl())
  } catch {
    useAppStore.getState().setConn('closed')
    scheduleRetry()
    return
  }
  socket = ws
  ws.onopen = () => {
    backoff = 1000
    lastMessage = Date.now()
    useAppStore.getState().setConn('open')
  }
  ws.onmessage = (ev: MessageEvent<string>) => {
    lastMessage = Date.now()
    let msg: WsMessage
    try {
      msg = JSON.parse(ev.data) as WsMessage
    } catch {
      return
    }
    useAppStore.getState().apply(msg)
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    useAppStore.getState().setConn('closed')
    scheduleRetry()
  }
  ws.onerror = () => {
    ws.close()
  }
}

/** 앱 시작 때 한 번 (main.tsx) */
export function startConnection() {
  if (started) return
  started = true
  open()
  watchdog = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN && Date.now() - lastMessage > SILENCE_MS) {
      socket.close() // onclose가 다시 접속을 예약한다
    }
  }, 5000)
  // 폰 화면을 다시 켰을 때 기다리지 않고 바로 다시 접속
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!socket || socket.readyState === WebSocket.CLOSED)) {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      backoff = 1000
      open()
    }
  })
}

export function stopConnection() {
  started = false
  if (retryTimer) clearTimeout(retryTimer)
  if (watchdog) clearInterval(watchdog)
  retryTimer = null
  watchdog = null
  socket?.close()
  socket = null
}

/** 다음 재접속까지 남은 대기(ms) 표시용 */
export function currentBackoffMs(): number {
  return backoff
}
