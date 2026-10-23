import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { OUTLINE, STATUS_LOOK } from '@/components/fx/statusLook'
import { cn } from '@/lib/utils'
import type { Severity } from '@/types/api'

/** 센서 아이콘 원 색 (와이어프레임: 정상은 연파랑 원 + 파랑 아이콘, 주의는 연주황 원 + 주황 아이콘) */
const ICON_TONE: Record<Severity, string> = {
  ok: 'bg-icon-bg text-brand',
  info: 'bg-icon-bg text-info',
  warn: 'bg-warn-soft text-warn',
  fault: 'bg-fault-soft text-fault',
  offline: 'bg-offline-soft text-offline',
}

export function IconCircle({ status, children }: { status: Severity; children: ReactNode }) {
  return (
    <span className={cn('flex size-[38px] shrink-0 items-center justify-center rounded-full', ICON_TONE[status])}>
      {children}
    </span>
  )
}

/** "● 정상" (점 + 글자, 색만으로 구분하지 않는다) */
export function StatusText({ status, className }: { status: Severity; className?: string }) {
  const look = STATUS_LOOK[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold', look.text, className)}>
      <span className={cn('size-2 rounded-full', look.dot)} aria-hidden />
      {look.label}
    </span>
  )
}

type Props = {
  to: string
  status: Severity
  icon: ReactNode
  title: ReactNode
  role?: string
  value: ReactNode
  stale?: boolean
  /** 센서를 아직 달지 않았을 때: 상태 대신 회색 '미설치' */
  absent?: boolean
}

/** 홈의 2열 센서 카드 (와이어프레임 01) */
export function SensorTile({ to, status, icon, title, role, value, stale, absent }: Props) {
  return (
    <Link
      to={to}
      className={cn('card block px-3 py-[11px] transition-transform active:scale-[.98]', !absent && OUTLINE[status])}
    >
      <div className="flex items-center justify-between">
        <IconCircle status={absent ? 'offline' : status}>{icon}</IconCircle>
        {absent ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-offline">
            <span className="size-2 rounded-full border-2 border-offline" aria-hidden />
            미설치
          </span>
        ) : (
          <StatusText status={status} />
        )}
      </div>
      <div className="mt-[7px] text-[13px] font-bold">
        {title}
        {role ? <span className="ml-1 font-medium text-ink-3">{role}</span> : null}
      </div>
      <div className={cn('num text-[12px] text-ink-2', stale && 'opacity-55')}>{value}</div>
    </Link>
  )
}
