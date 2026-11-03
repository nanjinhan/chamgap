import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useFreshness, useNodeIds } from '@/hooks/useNode'
import { useAppStore } from '@/store/useAppStore'

const LINKS = [
  { to: '/', label: '홈', en: 'HOME' },
  { to: '/water', label: '급수', en: 'WATER' },
  { to: '/diagnostics', label: '진단', en: 'CHECK' },
  { to: '/history/Z1', label: '기록', en: 'HISTORY' },
  { to: '/settings', label: '설정', en: 'SETTINGS' },
]

function Status() {
  const conn = useAppStore((s) => s.conn)
  const ids = useNodeIds()
  const nodes = useAppStore((s) => s.nodes)
  const last =
    ids
      .map((id) => nodes[id]?.last_seen)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null
  const { ago } = useFreshness(last)
  const online = ids.filter((id) => nodes[id]?.online).length
  return (
    <p className="text-[12px] text-ds-text-3">
      {conn === 'open' ? 'Supabase 연결됨' : '연결하는 중…'} · {online}/{ids.length}구역 · 마지막 값 {ago}
    </p>
  )
}

/** "— MENU"를 누르면 덮는 메뉴 (Esc·닫기·링크를 누르면 닫힌다) */
export function MenuSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="메뉴"
      className="fixed inset-0 z-50 bg-[#1f2824]/80 backdrop-blur-xl"
      style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}
    >
      <div className="mx-auto flex h-full max-w-[430px] flex-col px-[26px] pb-8 lg:max-w-[1160px] lg:px-12">
        <div className="flex h-[38px] items-center justify-between">
          <span className="text-[15px] tracking-[0.04em]">CHAMGAP</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-[38px] items-center gap-2.5 text-[13px] tracking-[0.06em]"
          >
            <span className="relative block size-[14px]" aria-hidden>
              <span className="absolute top-1/2 left-0 block h-[1.5px] w-full rotate-45 bg-white" />
              <span className="absolute top-1/2 left-0 block h-[1.5px] w-full -rotate-45 bg-white" />
            </span>
            CLOSE
          </button>
        </div>
        <nav aria-label="주 메뉴" className="mt-10 flex flex-col">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={onClose}
              className="flex items-baseline justify-between border-b border-white/15 py-4"
            >
              <span className="text-[30px] font-light">{l.label}</span>
              <span className="text-[12px] tracking-[0.12em] text-ds-text-3">{l.en}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <Status />
        </div>
      </div>
    </div>
  )
}
