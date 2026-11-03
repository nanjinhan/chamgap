import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconBack, IconStopSquare } from '@/components/icons'
import { stopAll as sendStopAll } from '@/lib/commands'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToasts'
import { MenuSheet } from './MenuSheet'

/** 모두 정지 (SAFE-06): 확인 창 없이 바로. 넣자마자 알리고, 결과는 문제가 있을 때만 다시 알린다 */
function useStopAll() {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await sendStopAll(Object.keys(useAppStore.getState().nodes))
      if (!r.sent) {
        toast.error(r.message)
        return
      }
      toast.ok(r.message)
      void r.results.then((list) => {
        const failed = list.filter((x) => !x.ok)
        if (failed.length) toast.error('정지가 확인되지 않은 구역이 있어요', failed.map((x) => x.message).join(' · '))
      })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

/** 연결이 끊겼을 때만 보이는 줄 (UI-07) */
function ConnLine() {
  const conn = useAppStore((s) => s.conn)
  const everOpened = useAppStore((s) => s.everOpened)
  const configError = useAppStore((s) => s.configError)
  const text = configError ? 'Supabase 설정 없음' : conn !== 'open' && everOpened ? '연결 끊김 · 다시 연결 중' : null
  if (!text) return null
  return (
    <div role="status" className="mt-2 flex">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[12px] font-medium backdrop-blur">
        <span className="size-1.5 rounded-full bg-[var(--ds-fault)]" aria-hidden />
        {text}
      </span>
    </div>
  )
}

/**
 * 맨 위 (새 디자인 공통): 하위 화면은 둥근 뒤로 버튼 + CHAMGAP, 오른쪽은 "— MENU".
 * 디자인에는 없지만 안전 규칙상 모든 화면에 '정지'를 MENU 옆에 둔다.
 */
export function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const stop = useStopAll()
  const home = pathname === '/'

  return (
    <header className="relative z-30" style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}>
      <div className="flex h-[38px] items-center justify-between">
        <div className="flex items-center gap-3">
          {home ? null : (
            <button
              type="button"
              aria-label="뒤로"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
              className="flex size-[34px] items-center justify-center rounded-full border border-[var(--ds-glass-line)] bg-white/5 backdrop-blur"
            >
              <IconBack size={18} strokeWidth={1.6} />
            </button>
          )}
          <span className="text-[15px] font-normal tracking-[0.04em]">CHAMGAP</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={stop.run}
            aria-label="모든 구역 펌프 정지"
            aria-busy={stop.busy}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-[#d6334a]/90 px-3 text-[12px] font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,.18)] active:scale-95"
          >
            <IconStopSquare size={10} />
            정지
          </button>
          <button
            type="button"
            aria-label="메뉴 열기"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
            className="flex h-[38px] items-center gap-2.5 text-[13px] tracking-[0.06em]"
          >
            <span className="block h-[1.5px] w-[18px] bg-white" aria-hidden />
            MENU
          </button>
        </div>
      </div>
      <ConnLine />
      {menu ? <MenuSheet onClose={() => setMenu(false)} /> : null}
    </header>
  )
}
