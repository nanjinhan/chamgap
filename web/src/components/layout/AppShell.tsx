import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { Outlet, useLocation } from 'react-router-dom'
import { ToastHost } from '@/components/fx/ToastHost'
import { useReducedMotionAttribute } from '@/lib/motion'
import { TopBar } from './TopBar'

/**
 * 공통 틀 (새 디자인 design/*.jpg): 사진 톤의 회색·초록 배경 → 맨 위 CHAMGAP · 정지 · MENU → 화면 내용.
 * 폭은 폰 폭(최대 430px). 홈은 밝은 회색, 하위 화면은 어두운 초록 배경.
 */
export function AppShell() {
  const reduced = useReducedMotionAttribute()
  const { pathname } = useLocation()
  const home = pathname === '/'
  // 끝까지 당겼을 때 보이는 바탕색도 화면 톤에 맞춘다
  useEffect(() => {
    document.body.style.background = home ? '#6b7982' : '#2b3433'
  }, [home])
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="relative min-h-dvh text-white">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0"
          style={{ background: home ? 'var(--ds-bg-home)' : 'var(--ds-bg-sub)' }}
        />
        <div
          className={`relative z-10 mx-auto w-full max-w-[430px] lg:max-w-[1160px] lg:px-12 ${home ? 'px-[26px]' : 'px-4'}`}
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
        >
          <TopBar />
          <main>
            <Outlet />
          </main>
        </div>
        <ToastHost />
      </div>
    </MotionConfig>
  )
}
