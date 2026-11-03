import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { zoneIds, zoneProfile } from '@/config/zones'
import { cn } from '@/lib/utils'
import type { NodeId, Severity } from '@/types/api'

/**
 * 새 디자인(design/*.jpg) 공통 부품. 어두운 회색·초록 배경 위 유리 카드, 연두 포인트, 흰 글자.
 */

/** 유리 카드 (디자인 02~08의 둥근 회색 판) */
export function Panel({
  className,
  children,
  as: As = 'section',
  ...rest
}: {
  className?: string
  children: ReactNode
  as?: 'section' | 'div'
  'aria-label'?: string
}) {
  return (
    <As
      {...rest}
      className={cn(
        'rounded-[20px] border border-[var(--ds-panel-line)] bg-[var(--ds-panel)] p-3.5 backdrop-blur-md',
        className,
      )}
    >
      {children}
    </As>
  )
}

/** 카드 안 작은 칸 */
export function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-[16px] border border-white/[0.06] bg-[var(--ds-panel-2)] p-3', className)}>
      {children}
    </div>
  )
}

/** 카드 제목 줄: 왼쪽 제목, 오른쪽 '상세 보기 >' 같은 링크 */
export function PanelHeader({
  title,
  to,
  more,
  right,
}: {
  title: ReactNode
  to?: string
  more?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {right ??
        (to ? (
          <Link to={to} className="inline-flex items-center gap-0.5 text-[12.5px] text-ds-text-2">
            {more ?? '상세 보기'}
            <ChevronRight size={14} strokeWidth={1.6} />
          </Link>
        ) : null)}
    </div>
  )
}

/** 범위 막대 (트랙 + 연두 채움) */
export function RangeBar({ frac, className }: { frac: number | null; className?: string }) {
  return (
    <div className={cn('h-[4px] rounded-full bg-white/20', className)}>
      {frac != null ? (
        <div
          className="h-full rounded-full bg-[var(--ds-lime-soft)]"
          style={{ width: `${Math.min(1, Math.max(0, frac)) * 100}%` }}
        />
      ) : null}
    </div>
  )
}

const DOT: Record<Severity, string> = {
  ok: 'bg-[var(--ds-chart)]',
  info: 'bg-[var(--ds-info)]',
  warn: 'bg-[var(--ds-warn)]',
  fault: 'bg-[var(--ds-fault)]',
  offline: 'bg-[var(--ds-offline)]',
}
const TEXT: Record<Severity, string> = {
  ok: 'text-[var(--ds-chart)]',
  info: 'text-[var(--ds-info)]',
  warn: 'text-[var(--ds-warn)]',
  fault: 'text-[var(--ds-fault)]',
  offline: 'text-[var(--ds-offline)]',
}
const STATUS_KO: Record<Severity, string> = {
  ok: '정상',
  info: '정보',
  warn: '주의',
  fault: '고장',
  offline: '끊김',
}

/** "● 정상" (색 + 글자, UI-05) */
export function StatusLabel({ status, text, className }: { status: Severity; text?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] font-medium', TEXT[status], className)}>
      <span className={cn('size-[9px] rounded-full', DOT[status])} aria-hidden />
      {text ?? STATUS_KO[status]}
    </span>
  )
}

/** 하위 화면 제목 (디자인 02~05): 작은 "Z1" + 연두 밑줄 + 큰 식물 이름 + "몬스테라 >" */
export function ZoneTitle({
  id,
  sub,
  subTo,
  className,
}: {
  id: NodeId
  sub?: string
  subTo?: string
  className?: string
}) {
  const p = zoneProfile(id)
  const subNode = (
    <span className="inline-flex items-center gap-1 text-[13px] text-ds-text-2">
      {sub ?? p.nameKo}
      {subTo ? <ChevronRight size={14} strokeWidth={1.6} /> : null}
    </span>
  )
  return (
    <div className={cn('mt-4 pl-2', className)} style={{ textShadow: 'var(--ds-shadow-text)' }}>
      <div className="text-[15px]">{id}</div>
      <div className="mt-1.5 h-[3px] w-[60px] rounded-full bg-white/25">
        <div className="h-full w-1/2 rounded-full bg-[var(--ds-lime)]" />
      </div>
      <h1 className="mt-2 text-[40px] leading-[1.05] font-normal tracking-[-0.02em] lg:text-[52px]">{p.name}</h1>
      <div className="mt-1.5">{subTo ? <Link to={subTo}>{subNode}</Link> : subNode}</div>
    </div>
  )
}

/** 알약 탭 (디자인 02~04 온습도·토양수분·무게): 고른 것은 초록 */
export function PillTabs({
  items,
  className,
}: {
  items: { to: string; label: string; active: boolean }[]
  className?: string
}) {
  return (
    <nav className={cn('grid gap-2.5', className)} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          replace
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'flex h-[42px] items-center justify-center rounded-full border text-[14.5px] transition-colors',
            t.active
              ? 'border-[#a6d27c]/60 bg-[var(--ds-green)] font-semibold shadow-[0_6px_18px_rgba(110,154,82,.35)]'
              : 'border-white/10 bg-white/[0.08] text-white/90',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

/** 구역 고르기 알약 (디자인 02: 사진 + Z1 + 몬스테라) */
export function ZonePills({
  active,
  seen,
  to,
  className,
}: {
  active: NodeId
  seen: NodeId[]
  to: (id: NodeId) => string
  className?: string
}) {
  return (
    <nav
      aria-label="구역 고르기"
      className={cn(
        'flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full border border-white/15 bg-white/[0.12] p-1 backdrop-blur-md',
        className,
      )}
    >
      {zoneIds(seen).map((id) => {
        const p = zoneProfile(id)
        const on = id === active
        return (
          <Link
            key={id}
            to={to(id)}
            replace
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-3 pl-0.5',
              on && 'bg-white/[0.14] ring-1 ring-white/25',
            )}
          >
            <span className={cn('size-[34px] overflow-hidden rounded-full', on && 'ring-2 ring-[var(--ds-lime)]/70')}>
              {p.photo ? <img src={p.photo} alt="" className="size-full object-cover" /> : null}
            </span>
            <span className="leading-tight">
              <span className="block text-[13px]">{id}</span>
              <span className="block text-[10px] text-ds-text-2">{p.nameKo}</span>
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

/** 큰 연두 버튼 (디자인 05·06·08) */
export function LimeButton({
  children,
  to,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode
  to?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  const cls = cn(
    'flex h-[60px] w-full items-center justify-center gap-3 rounded-full bg-[var(--ds-btn-lime)] text-[17px] font-semibold text-[var(--ds-btn-lime-ink)] shadow-[0_10px_28px_rgba(160,210,100,.25)] transition-transform active:scale-[.98]',
    disabled && 'pointer-events-none opacity-45',
    className,
  )
  if (to && !disabled) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  )
}

/** 흐린 테두리 버튼 (디자인 07 '급수 중지하기', 08 '홈으로') */
export function GhostButton({
  children,
  to,
  onClick,
  className,
}: {
  children: ReactNode
  to?: string
  onClick?: () => void
  className?: string
}) {
  const cls = cn(
    'flex h-[56px] items-center justify-center gap-2.5 rounded-full border border-white/25 bg-white/[0.08] px-6 text-[16px] backdrop-blur transition-transform active:scale-[.98]',
    className,
  )
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  )
}

/**
 * 1초 길게 눌러야 실행되는 연두 버튼 (SAFE-05: 급수는 길게 누르기로만).
 * 누르는 동안 왼쪽부터 차오르고, 떼면 취소. 키보드는 Space·Enter를 1초 누른다.
 */
export function HoldButton({
  children,
  onHold,
  disabled,
  hint = '1초 길게 누르기',
}: {
  children: ReactNode
  onHold: () => void
  disabled?: boolean
  hint?: string
}) {
  const [p, setP] = useState(0)
  const holding = useRef(false)
  const start = useRef<number | null>(null)
  const raf = useRef<number | null>(null)
  const fired = useRef(false)

  const stop = () => {
    holding.current = false
    start.current = null
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    setP(0)
  }
  // 시각은 requestAnimationFrame이 주는 값으로 잰다 (첫 프레임이 시작)
  const tick = (ts: number) => {
    if (!holding.current) return
    start.current ??= ts
    const k = Math.min(1, (ts - start.current) / 1000)
    setP(k)
    if (k >= 1 && !fired.current) {
      fired.current = true
      stop()
      onHold()
      return
    }
    raf.current = requestAnimationFrame(tick)
  }
  const begin = () => {
    if (disabled || holding.current) return
    holding.current = true
    fired.current = false
    start.current = null
    raf.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => stop(), [])

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${typeof children === 'string' ? children : '실행'} (${hint})`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          begin()
        }
      }}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && stop()}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative flex h-[60px] w-full touch-none items-center justify-center overflow-hidden rounded-full bg-[var(--ds-btn-lime)] text-[17px] font-semibold text-[var(--ds-btn-lime-ink)] shadow-[0_10px_28px_rgba(160,210,100,.25)] select-none',
        disabled && 'opacity-45',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-[#9fd062]"
        style={{ width: `${p * 100}%`, transition: p === 0 ? 'width .2s' : 'none' }}
      />
      <span className="relative flex flex-col items-center leading-tight">
        <span className="flex items-center gap-2.5">{children}</span>
        <span className="text-[11px] font-medium opacity-70">{p > 0 ? '계속 누르세요…' : hint}</span>
      </span>
    </button>
  )
}

/** 화면 위 오른쪽 장식 식물 사진 (가장자리를 흐리게) */
export function CornerPlant({ src, className }: { src: string | null; className?: string }) {
  if (!src) return null
  const mask = 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 45%, transparent 100%)'
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={cn('pointer-events-none absolute object-cover', className)}
      style={{ maskImage: mask, WebkitMaskImage: mask, filter: 'brightness(.86) saturate(.95)' }}
    />
  )
}
