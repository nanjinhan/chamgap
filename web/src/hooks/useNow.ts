import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store/useAppStore'

// 화면 전체가 타이머 하나를 나눠 쓴다
let tick = Date.now()
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(cb: () => void) {
  subs.add(cb)
  if (!timer) {
    timer = setInterval(() => {
      tick = Date.now()
      subs.forEach((f) => f())
    }, 1000)
  }
  return () => {
    subs.delete(cb)
    if (subs.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * 지금 시각(ms)을 1초마다 갱신한다. 폰과 노트북 시계가 달라도 "n초 전"이 맞도록
 * 서버 시계 기준으로 고친 값이다 (서버가 보낸 server_time과의 차이).
 */
export function useNow(): number {
  const t = useSyncExternalStore(
    subscribe,
    () => tick,
    () => tick,
  )
  const offset = useAppStore((s) => s.clockOffsetMs)
  return t + offset
}
