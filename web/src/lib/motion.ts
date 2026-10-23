import { useEffect, useSyncExternalStore } from 'react'
import { useSettings } from '@/store/useSettings'

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** 운영체제 '동작 줄이기' 또는 앱 설정 '움직임 줄이기' (UI-09) */
export function useReducedMotion(): boolean {
  const os = useMediaQuery('(prefers-reduced-motion: reduce)')
  const app = useSettings((s) => s.reducedMotion)
  return os || app
}

/** 마우스처럼 hover가 되는 기기 (기울임·확대 효과는 이때만) */
export function useCanHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

/** 탭이 보이는가 (안 보이면 WebGL을 멈춘다) */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  )
}

/** <html data-reduced-motion> 을 맞춰 CSS 애니메이션도 끈다 */
export function useReducedMotionAttribute() {
  const reduced = useReducedMotion()
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false'
  }, [reduced])
  return reduced
}
