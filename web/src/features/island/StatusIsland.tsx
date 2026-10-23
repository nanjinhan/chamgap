import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

/**
 * 맨 위 검은 알약 (와이어프레임 01·09의 compact 모양).
 * 지금은 글자만 바꾼다. 크기가 바뀌는 Dynamic Island 동작(급수 진행, 고장 알림 펼침)은 다음 단계에서 붙인다.
 */
export function StatusIsland() {
  const conn = useAppStore((s) => s.conn)
  const everOpened = useAppStore((s) => s.everOpened)
  const summary = useAppStore(
    useShallow((s) => {
      const nodes = Object.values(s.nodes)
      const online = nodes.filter((n) => n.online).length
      const diags = nodes.filter((n) => n.online).flatMap((n) => n.diagnostics)
      const faults = diags.filter((d) => d.severity === 'fault').length
      const warns = diags.filter((d) => d.severity === 'warn').length
      const pumping = nodes.find((n) => n.pump.on)
      return {
        total: nodes.length,
        online,
        faults,
        warns,
        pumping: pumping?.node ?? null,
        ml: pumping?.pump.ml ?? null,
      }
    }),
  )

  let left: { dot: string; text: string }
  let right: { dot: string; text: string } | null = null
  if (conn !== 'open' && everOpened) {
    left = { dot: 'bg-fault-dot', text: '서버 끊김 · 다시 연결 중' }
  } else if (conn !== 'open') {
    left = { dot: 'bg-offline', text: '연결하는 중…' }
  } else if (summary.pumping) {
    left = { dot: 'bg-brand', text: `${summary.pumping} 급수 중${summary.ml ? ` · ${summary.ml}mL` : ''}` }
  } else {
    const allOnline = summary.online === summary.total
    left = {
      dot: allOnline ? 'bg-[#3ddc84]' : 'bg-warn-dot',
      text:
        summary.total === 0
          ? '구역 없음'
          : allOnline
            ? `${summary.total}구역 연결`
            : `${summary.online}/${summary.total}구역 연결`,
    }
    if (summary.faults) right = { dot: 'bg-fault-dot', text: `고장 ${summary.faults}` }
    else if (summary.warns) right = { dot: 'bg-[#ffb347]', text: `주의 ${summary.warns}` }
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}
    >
      <div
        role="status"
        aria-live="polite"
        className="flex h-[34px] items-center gap-2 rounded-full bg-island px-3.5 text-[12px] font-semibold whitespace-nowrap text-white"
      >
        <span className={cn('size-2 rounded-full', left.dot)} aria-hidden />
        {left.text}
        {right ? (
          <>
            <span className="opacity-50" aria-hidden>
              |
            </span>
            <span className={cn('size-2 rounded-full', right.dot)} aria-hidden />
            {right.text}
          </>
        ) : null}
      </div>
    </div>
  )
}
