import { useEffect, useId, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import BorderGlow from '@/components/react-bits/BorderGlow'
import ElectricBorder from '@/components/react-bits/ElectricBorder'
import GlareHover from '@/components/react-bits/GlareHover'
import SpotlightCard from '@/components/react-bits/SpotlightCard'
import TiltedCard from '@/components/react-bits/TiltedCard'
import { useCanHover, useReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

type BoxProps = { children: ReactNode; className?: string; style?: CSSProperties }

/** 센서 카드: Spotlight Card (밝은 테마, 파란 스포트라이트) */
export function SpotlightBox({ children, className, style }: BoxProps) {
  const reduced = useReducedMotion()
  if (reduced) {
    return (
      <div className={cn('card', className)} style={style}>
        {children}
      </div>
    )
  }
  return (
    <SpotlightCard
      theme="light"
      spotlightColor="rgba(47,107,255,.12)"
      intensity={0.12}
      borderGlow={0.25}
      flare={false}
      className={cn('card !border-0', className)}
      style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-card)', ...style }}
    >
      {children}
    </SpotlightCard>
  )
}

/** 홈 구역 카드: 마우스에서만 기울인다. 터치에서는 일반 카드 */
export function TiltBox({ children, className, style }: BoxProps) {
  const reduced = useReducedMotion()
  const canHover = useCanHover()
  if (reduced || !canHover) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }
  return (
    <TiltedCard
      containerWidth="100%"
      containerHeight="auto"
      rotateAmplitude={7}
      scaleOnHover={1.02}
      glare={0.12}
      shadow={0.4}
      radius={22}
      intro={false}
      className={className}
      style={style}
    >
      {children}
    </TiltedCard>
  )
}

/**
 * A·B 비교 카드가 주의일 때: 항상 보이는 주황 테두리 + 처음 한 번 테두리를 도는 빛 (Border Glow).
 * Border Glow는 마우스가 가까이 와야 빛나므로 터치폰에서도 보이게 테두리를 깐다.
 */
export function GlowBox({ children, className, active }: BoxProps & { active: boolean }) {
  const reduced = useReducedMotion()
  if (!active) return <div className={cn('card', className)}>{children}</div>
  if (reduced) {
    return <div className={cn('card outline-2 outline-warn-dot', className)}>{children}</div>
  }
  return (
    <div className="rounded-[var(--radius-card)] outline-2 outline-warn-dot">
      <BorderGlow
        animated
        glowColor="32 90 55"
        backgroundColor="#ffffff"
        colors={['#E8890C', '#FFB54D', '#FFD08A']}
        borderRadius={22}
        glowRadius={28}
        glowIntensity={0.8}
        fillOpacity={0.15}
        className={cn('shadow-card', className)}
      >
        {children}
      </BorderGlow>
    </div>
  )
}

// Electric Border는 화면에 하나까지: 먼저 붙은 카드만 쓰고 나머지는 테두리로 대체
let electricOwner: string | null = null
const electricSubs = new Set<() => void>()
const notify = () => electricSubs.forEach((f) => f())
function subscribeElectric(cb: () => void) {
  electricSubs.add(cb)
  return () => electricSubs.delete(cb)
}

/** 고장(fault) 카드만: 빨간 전기 테두리 (깜빡임 없음 대체 가능) */
export function ElectricBox({ children, className }: BoxProps) {
  const reduced = useReducedMotion()
  const id = useId()
  const owner = useSyncExternalStore(subscribeElectric, () => electricOwner)
  useEffect(() => {
    // 비어 있으면 차지한다. 주인이 사라지면 기다리던 카드가 이어받는다
    const claim = () => {
      if (electricOwner == null) {
        electricOwner = id
        notify()
      }
    }
    claim()
    electricSubs.add(claim)
    return () => {
      electricSubs.delete(claim)
      if (electricOwner === id) {
        electricOwner = null
        notify()
      }
    }
  }, [id])
  const mine = owner === id
  if (reduced || !mine) {
    return <div className={cn('card outline-2 outline-fault-dot', className)}>{children}</div>
  }
  return (
    <ElectricBorder
      color="#D6334A"
      theme="light"
      borderRadius={22}
      speed={0.6}
      chaos={0.35}
      thickness={1.5}
      flicker={0}
      intro={false}
      interactive={false}
      className={cn('card', className)}
    >
      {children}
    </ElectricBorder>
  )
}

/** 노트북 구역 카드: 마우스를 올리면 빛이 지나간다 */
export function GlareBox({ children, className, style }: BoxProps) {
  const reduced = useReducedMotion()
  const canHover = useCanHover()
  if (reduced || !canHover) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }
  return (
    <GlareHover
      background="transparent"
      borderRadius="24px"
      glareColor="#ffffff"
      glareOpacity={0.35}
      glareSize={40}
      className={className}
      style={style}
    >
      {children}
    </GlareHover>
  )
}
