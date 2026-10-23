import { forwardRef, type AnchorHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AnimatedContent from '@/components/react-bits/AnimatedContent'
import ClickSpark from '@/components/react-bits/ClickSpark'
import Counter from '@/components/react-bits/Counter'
import FadeContent from '@/components/react-bits/FadeContent'
import GlassSurface from '@/components/react-bits/GlassSurface'
import GradualBlur from '@/components/react-bits/GradualBlur'
import LatticeLoader from '@/components/react-bits/LatticeLoader'
import Magnet from '@/components/react-bits/Magnet'
import PillNav, { type PillNavItem } from '@/components/react-bits/PillNav'
import Stepper, { Step } from '@/components/react-bits/Stepper'
import { useCanHover, useReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** 서버 연결 중 */
export function Loader({ label = '서버에 연결하는 중…' }: { label?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <p className="caption">{label}</p>
  return <LatticeLoader label={label} showTimer={false} color="#2F6BFF" pattern="orbit" fontSize={14} />
}

/** 굴러가는 숫자 (오늘 급수량 등). 처음 표시 때는 굴리지 않는다 */
export function RollNumber({
  value,
  fontSize = 22,
  className,
}: {
  value: number
  fontSize?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={cn('num', className)}>{Math.round(value).toLocaleString('en-US')}</span>
  return (
    <Counter
      value={Math.round(value)}
      fontSize={fontSize}
      fontWeight={800}
      textColor="inherit"
      intro={false}
      motionBlur={false}
      tabular
      className={className}
    />
  )
}

/** 앱 전체 클릭 반짝임 (파랑, 작게). 정지 버튼은 빨강 */
export function Sparks({ children, color = '#2F6BFF' }: { children: ReactNode; color?: string }) {
  const reduced = useReducedMotion()
  return (
    <ClickSpark sparkColor={color} sparkSize={8} sparkRadius={18} sparkCount={7} duration={380} disabled={reduced}>
      {children}
    </ClickSpark>
  )
}

/** 노트북의 급수 버튼: 약하게 끌어당김 */
export function MagnetWrap({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const canHover = useCanHover()
  return (
    <Magnet
      padding={40}
      magnetStrength={3}
      disabled={reduced || !canHover}
      wrapperClassName="!block w-full"
      innerClassName="w-full"
    >
      {children}
    </Magnet>
  )
}

/** 스크롤 목록 아래쪽 흐림 (하단 바와 겹치는 곳) */
export function BottomBlur() {
  return (
    <GradualBlur
      target="page"
      position="bottom"
      height="5.5rem"
      strength={1.6}
      layers={6}
      zIndex={30}
      className="pointer-events-none lg:hidden"
    />
  )
}

/** 유리 면 (하단 탭 바, 상단 헤더) */
export function Glass({
  children,
  className,
  height,
  radius = 24,
}: {
  children: ReactNode
  className?: string
  height: number
  radius?: number
}) {
  return (
    <GlassSurface
      width="100%"
      height={height}
      borderRadius={radius}
      backgroundOpacity={0.55}
      brightness={98}
      opacity={0.9}
      blur={12}
      saturation={1.4}
      displace={0.4}
      distortionScale={-60}
      className={className}
    >
      {children}
    </GlassSurface>
  )
}

/** 화면 섹션 등장: 20px 이내, 0.3초 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <AnimatedContent distance={18} duration={0.3} delay={delay} trigger="mount" once className={className}>
      {children}
    </AnimatedContent>
  )
}

export function FadeIn({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const reduced = useReducedMotion()
  if (reduced)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  return (
    <FadeContent duration={0.3} trigger="mount" once className={className} style={style}>
      {children}
    </FadeContent>
  )
}

/** 보정 마법사 단계 표시. 단계 이동은 부모가 정한다 (ack가 와야 다음) */
export function Steps({ step, children, className }: { step: number; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <Stepper
      step={step}
      showFooter={false}
      disableStepIndicators
      indicator="numbers"
      theme="light"
      accentColor="#2F6BFF"
      frame={false}
      transition={reduced ? 'none' : 'slide'}
      className={className}
    >
      {children}
    </Stepper>
  )
}
export { Step }

/** react-router Link를 href로 받는 링크 (PillNav용) */
const RouterAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(
  function RouterAnchor({ href = '/', ...rest }, ref) {
    return <Link to={href} ref={ref} {...rest} />
  },
)

/** 구역 탭 Z1·Z2·Z3 (알약). 탭 옆에 상태 점 */
export function PillTabs({ items, activeHref, label }: { items: PillNavItem[]; activeHref: string; label: string }) {
  const reduced = useReducedMotion()
  return (
    <PillNav
      items={items}
      activeHref={activeHref}
      linkComponent={RouterAnchor}
      theme="light"
      layout="joined"
      size="md"
      surface="solid"
      itemStyle="pill"
      hoverEffect="glide"
      indicator="pill"
      highlightColor="#2F6BFF"
      highlightTextColor="#FFFFFF"
      barColor="#FFFFFF"
      textColor="#18213A"
      intro={!reduced}
      collapse="never"
      ariaLabel={label}
    />
  )
}
