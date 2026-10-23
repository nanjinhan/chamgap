import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import AnimatedList, { type AnimatedListEntry } from '@/components/react-bits/AnimatedList'
import { useReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * 새 항목이 위에서 들어오는 목록 (진단 카드, 사전 점검).
 * 카드 안에 버튼이 있어 React Bits AnimatedList(선택형 listbox) 대신 motion layout을 쓴다.
 */
export function FxList<T>({
  items,
  getKey,
  render,
  className,
  gap = 12,
}: {
  items: T[]
  getKey: (item: T) => string
  render: (item: T) => ReactNode
  className?: string
  gap?: number
}) {
  const reduced = useReducedMotion()
  return (
    <ul className={cn('flex flex-col', className)} style={{ gap }}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={getKey(item)}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {render(item)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/** 선택할 수 있는 사건 목록 (기록 화면: 고르면 그래프에 그 시각을 표시) */
export function EventList({
  items,
  onSelect,
  maxHeight = 360,
}: {
  items: AnimatedListEntry[]
  onSelect?: (index: number) => void
  maxHeight?: number
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatedList
      items={items}
      onItemSelect={(_, i) => onSelect?.(i)}
      initialSelectedIndex={-1}
      theme="light"
      accentColor="#2F6BFF"
      animation={reduced ? 'none' : 'slide'}
      animateOnce
      showGradients
      displayScrollbar={false}
      frame={false}
      width="100%"
      maxHeight={maxHeight}
      gap={6}
    />
  )
}
