import type { ReactNode } from 'react'
import SloshGauge from '@/components/react-bits/SloshGauge'
import { useReducedMotion } from '@/lib/motion'

/** 급수 화면의 물 원: 물 높이 = 급수량/최대. 가운데 글자는 위에 겹친다 (숫자는 움직이지 않는다) */
export function WaterGauge({
  ml,
  max = 50,
  size = 188,
  children,
}: {
  ml: number
  max?: number
  size?: number
  children?: ReactNode
}) {
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(100, (ml / max) * 100))
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <SloshGauge
        value={pct}
        width={size}
        height={size}
        radius={size / 2}
        showValue={false}
        interactive={false}
        liquidColor="#7EA8FF"
        glassColor="#E8EFFF"
        ticks={0}
        tilt={reduced ? 0 : 0.3}
        splash={reduced ? 0 : 0.3}
        ariaLabel={`급수량 ${ml}mL`}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}
