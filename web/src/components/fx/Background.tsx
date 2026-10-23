import { lazy, Suspense } from 'react'
import { usePageVisible, useReducedMotion } from '@/lib/motion'

// WebGL 배경은 화면에 하나만 (NFR-06). 늦게 불러와 첫 화면을 막지 않는다.
const SoftAurora = lazy(() => import('@/components/react-bits/SoftAurora'))

/**
 * 앱 배경: 연하늘 그라데이션 위에 Soft Aurora를 아주 흐리게.
 * 움직임 줄이기이거나 탭이 안 보이면 WebGL을 내리고 정지 그라데이션만 둔다 (UI-09).
 */
export function Background() {
  const reduced = useReducedMotion()
  const visible = usePageVisible()
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ background: 'var(--bg)' }}>
      {!reduced && visible ? (
        <Suspense fallback={null}>
          <SoftAurora
            className="absolute inset-0 h-full w-full"
            color1="#2F6BFF"
            color2="#9FC2FF"
            lightMode
            opacity={0.3}
            speed={0.3}
            brightness={1}
            enableMouseInteraction={false}
            clickPulse={false}
            intro={false}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
