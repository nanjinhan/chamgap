import { useState, type ComponentType } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { IconAlert, IconChart, IconDrop, IconHome, IconStopSquare, IconTerminal } from '@/components/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from '@/store/useToasts'

type Item = { to: string; label: string; icon: ComponentType<{ size?: number }>; match: (p: string) => boolean }

const ITEMS: Item[] = [
  { to: '/', label: '홈', icon: IconHome, match: (p) => p === '/' || p.startsWith('/zone') || p === '/settings' },
  { to: '/diagnostics', label: '진단', icon: IconAlert, match: (p) => p.startsWith('/diagnostics') },
  { to: '/water', label: '급수', icon: IconDrop, match: (p) => p.startsWith('/water') || p.startsWith('/calibrate') },
  { to: '/history/Z1', label: '기록', icon: IconChart, match: (p) => p.startsWith('/history') },
  { to: '/test', label: '시험 모드', icon: IconTerminal, match: (p) => p.startsWith('/test') },
]

/**
 * 하단: 아이콘 알약 메뉴 + 빨간 정지 버튼 (와이어프레임 01).
 * 정지는 모든 화면에서 한 번에, 확인 창 없이 (SAFE-06).
 */
export function BottomBar() {
  const { pathname } = useLocation()
  const [busy, setBusy] = useState(false)

  const stopAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.stopAll()
      const failed = Object.entries(r.results).filter(([, v]) => !v.ok)
      if (failed.length === 0) toast.ok('모든 구역에 정지를 보냈어요')
      else toast.error('정지가 안 된 구역이 있어요', failed.map(([k, v]) => `${k}: ${v.message ?? ''}`).join(' · '))
    } catch {
      // 오류 알림은 api가 띄운다
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-x-0 z-40 mx-auto flex max-w-[430px] items-center gap-2.5 px-4"
      style={{ bottom: 'calc(16px + var(--safe-bottom))' }}
    >
      <nav aria-label="주 메뉴" className="card flex h-[60px] flex-1 items-center justify-around rounded-full px-1.5">
        {ITEMS.map((item) => {
          const active = item.match(pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex size-11 items-center justify-center rounded-full transition-colors',
                active ? 'bg-brand text-white' : 'text-ink hover:bg-primary-soft',
              )}
            >
              <Icon size={20} />
            </Link>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={stopAll}
        aria-label="모든 구역 펌프 정지"
        aria-busy={busy}
        className="flex size-[60px] shrink-0 flex-col items-center justify-center gap-px rounded-full bg-fault-dot text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(214,51,74,.35)] transition-transform active:scale-95"
      >
        <IconStopSquare size={16} />
        정지
      </button>
    </div>
  )
}
