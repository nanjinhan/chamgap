import type { SVGProps } from 'react'

/**
 * 와이어프레임(docs/design/wireframe/src)에 쓰인 아이콘을 그대로 옮긴 것.
 * 24×24 기준, 선 1.8. 색은 color(currentColor)로 바꾼다.
 */

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, strokeWidth = 1.8, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M4 11l8-6 8 6v8H4z" />
  </Svg>
)

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </Svg>
)

export const IconDrop = (p: P) => (
  <Svg {...p}>
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </Svg>
)

export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 19h16M6 15l4-5 3 3 5-7" />
  </Svg>
)

export const IconTerminal = (p: P) => (
  <Svg {...p}>
    <path d="M5 7l4 4-4 4M12 17h7" />
  </Svg>
)

export const IconBell = (p: P) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
)

export const IconThermo = (p: P) => (
  <Svg {...p}>
    <path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z" />
  </Svg>
)

export const IconScale = (p: P) => (
  <Svg {...p}>
    <path d="M4 19h16M6 19l2-9h8l2 9M12 10V6M9 6h6" />
  </Svg>
)

export const IconPump = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 5v4M7 15l3-2M17 15l-3-2" />
  </Svg>
)

export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)

/** 정지 버튼의 흰 네모 */
export const IconStopSquare = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
)
