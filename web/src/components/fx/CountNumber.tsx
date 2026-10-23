import { useEffect, useRef, useState } from 'react'
import CountUp from '@/components/react-bits/CountUp'
import { formatFixed } from '@/lib/format'
import { useReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

type Props = {
  value: number | null | undefined
  decimals?: number
  className?: string
}

/**
 * 숫자: 값이 바뀔 때만 0.4초 Count Up. 처음 표시 때 0부터 세지 않는다.
 * 움직임 줄이기면 그냥 숫자.
 */
export function CountNumber({ value, decimals = 0, className }: Props) {
  const reduced = useReducedMotion()
  const prev = useRef<number | null>(null)
  const [run, setRun] = useState<{ from: number; to: number; id: number } | null>(null)

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prev.current = null
      return
    }
    const p = prev.current
    prev.current = value
    if (p != null && !reduced && Math.abs(p - value) >= Math.pow(10, -decimals) / 2) {
      setRun((r) => ({ from: p, to: value, id: (r?.id ?? 0) + 1 }))
    }
  }, [value, decimals, reduced])

  if (value == null || !Number.isFinite(value)) return <span className={cn('num', className)}>--</span>
  if (reduced || !run || run.to !== value) {
    return <span className={cn('num', className)}>{formatFixed(value, decimals)}</span>
  }
  return (
    <CountUp
      key={run.id}
      from={run.from}
      to={run.to}
      duration={0.4}
      decimals={decimals}
      separator=","
      trigger="load"
      className={cn('num', className)}
    />
  )
}
