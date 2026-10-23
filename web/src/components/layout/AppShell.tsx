import { MotionConfig } from 'motion/react'
import { Outlet, useLocation } from 'react-router-dom'
import { ToastHost } from '@/components/fx/ToastHost'
import { StatusIsland } from '@/features/island/StatusIsland'
import { useReducedMotionAttribute } from '@/lib/motion'
import { BottomBar } from './BottomBar'

/**
 * 공통 틀 (와이어프레임 01~07): 그라데이션 배경 → 맨 위 검은 알약 → 화면 내용 → 하단 알약 메뉴 + 정지 버튼.
 * 폭은 와이어프레임과 같은 폰 폭(최대 430px). 노트북 대시보드(와이어프레임 10)는 따로 만든다.
 */
export function AppShell() {
  const reduced = useReducedMotionAttribute()
  const { pathname } = useLocation()
  const home = pathname === '/'
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="relative min-h-dvh">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0"
          style={{ background: home ? 'var(--bg)' : 'var(--bg-sub)' }}
        />
        <StatusIsland />
        <main
          className="relative z-10 mx-auto w-full max-w-[430px] px-5"
          style={{
            paddingTop: 'calc(var(--safe-top) + 14px + 34px)',
            paddingBottom: 'calc(var(--safe-bottom) + 16px + 60px + 24px)',
          }}
        >
          <Outlet />
        </main>
        <BottomBar />
        <ToastHost />
      </div>
    </MotionConfig>
  )
}
