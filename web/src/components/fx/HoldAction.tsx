import { Droplets } from 'lucide-react'
import type { ReactNode } from 'react'
import HoldButton from '@/components/react-bits/HoldButton'
import { useReducedMotion } from '@/lib/motion'

type Props = {
  label?: ReactNode
  doneLabel?: ReactNode
  onHold: () => void
  disabled?: boolean
  holdMs?: number
}

/**
 * 길게 눌러 실행 (SAFE-05): 누르는 동안 채워지고, 1초 전에 떼면 취소.
 * 키보드는 Space·Enter를 1초 누르고 있으면 실행, Esc로 취소 (React Bits HoldButton).
 */
export function HoldAction({
  label = '길게 눌러 급수 (1초)',
  doneLabel = '급수 요청함',
  onHold,
  disabled,
  holdMs = 1000,
}: Props) {
  const reduced = useReducedMotion()
  return (
    <div className="w-full">
      <HoldButton
        holdTime={holdMs}
        releaseTime={150}
        onHold={onHold}
        disabled={disabled}
        size="lg"
        radius={16}
        backgroundColor={disabled ? '#C9D3E6' : '#2F6BFF'}
        fillColor="#1D4FD8"
        textColor="#FFFFFF"
        fillTextColor="#FFFFFF"
        icon={<Droplets className="size-5" aria-hidden />}
        doneLabel={doneLabel}
        wave={!reduced}
        glow={!reduced}
        resetAfter={1500}
        className="w-full"
      >
        {label}
      </HoldButton>
      <span className="sr-only-text" aria-live="off">
        버튼을 1초 동안 누르고 있어야 실행됩니다. 키보드는 스페이스 키를 1초 누르세요.
      </span>
    </div>
  )
}
