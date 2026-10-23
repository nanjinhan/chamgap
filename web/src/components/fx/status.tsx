import { CircleCheck, CircleX, Info } from 'lucide-react'
import StatusMark from '@/components/react-bits/StatusMark'
import { useReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { Severity } from '@/types/api'
import { STATUS_LOOK } from './statusLook'

/** 단계 배지: 아이콘 + 글자 (알약) */
export function StatusBadge({ status, label, className }: { status: Severity; label?: string; className?: string }) {
  const look = STATUS_LOOK[status]
  const Icon = look.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] leading-5 font-bold',
        look.soft,
        look.text,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden strokeWidth={2.4} />
      {label ?? look.label}
    </span>
  )
}

/** 상태 점 + 글자 */
export function StatusDot({ status, label, className }: { status: Severity; label?: string; className?: string }) {
  const look = STATUS_LOOK[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-bold', look.text, className)}>
      <span className={cn('size-2 rounded-full', look.dot)} aria-hidden />
      {label ?? look.label}
    </span>
  )
}

/** 점검 항목 표시 (Status Mark): 통과 체크 / 실패 X / 확인 중 */
export function CheckMark({ state, size = 20 }: { state: 'ok' | 'fail' | 'running' | 'pending'; size?: number }) {
  const reduced = useReducedMotion()
  const status = state === 'ok' ? 'done' : state === 'fail' ? 'failed' : state
  if (reduced) {
    const Icon = state === 'ok' ? CircleCheck : state === 'fail' ? CircleX : Info
    return (
      <Icon
        className={cn(state === 'ok' ? 'text-ok' : state === 'fail' ? 'text-fault' : 'text-ink-2')}
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  return <StatusMark status={status} size={size} doneColor="#16834A" errorColor="#B4233A" color="#4F5B76" />
}

/**
 * 살아 있음 표시: 데이터를 받을 때마다 한 번 뛰는 점.
 * (React Bits PulseHeart는 클릭할 때만 뛰는 '좋아요' 버튼이라 대체 구현. COMPONENTS.md 참고)
 */
export function PulseDot({ beat, tone = 'ok', className }: { beat: number; tone?: Severity; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <span className={cn('relative inline-flex size-2.5', className)} aria-hidden>
      {!reduced && beat > 0 ? (
        <span
          key={beat}
          className={cn('absolute inset-0 rounded-full opacity-60', STATUS_LOOK[tone].dot)}
          style={{ animation: 'chamgap-ping 0.9s ease-out 1' }}
        />
      ) : null}
      <span
        key={`c${beat}`}
        className={cn('relative inline-flex size-2.5 rounded-full', STATUS_LOOK[tone].dot)}
        style={reduced ? undefined : { animation: 'chamgap-beat 0.45s ease-out 1' }}
      />
    </span>
  )
}
