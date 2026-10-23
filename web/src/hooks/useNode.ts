import { useShallow } from 'zustand/react/shallow'
import { fmtAgo, isStale } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { NodeId, NodeState } from '@/types/api'
import { useNow } from './useNow'

/** 구역 하나 (없으면 undefined) */
export function useNode(id: NodeId | undefined): NodeState | undefined {
  return useAppStore((s) => (id ? s.nodes[id] : undefined))
}

/** 구역 이름 목록 (Z1, Z2, Z3 순) */
export function useNodeIds(): NodeId[] {
  return useAppStore(useShallow((s) => Object.keys(s.nodes).sort()))
}

/** "n초 전"과 흐리게 할지 (30초 넘으면 흐리게, UI-08) */
export function useFreshness(lastSeen: string | null | undefined): { ago: string; stale: boolean } {
  const now = useNow()
  return { ago: fmtAgo(lastSeen, now), stale: isStale(lastSeen, now) }
}
