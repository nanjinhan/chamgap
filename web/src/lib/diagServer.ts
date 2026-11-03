import { useEffect, useState } from 'react'
import { useNow } from '@/hooks/useNow'
import { parseTs } from './nodeState'
import { supabase } from './supabase'

/**
 * 진단 서버(P6, 선택)가 켜져 있는지: service_status 표에 2분 안에 기록이 있으면 켜짐.
 * 진단 서버가 없으면 진단 목록은 비고, 값 보기·급수·보정은 그대로 된다 (SYS-06, UI-13).
 */
export function useDiagServer(): { alive: boolean | null; lastAt: string | null } {
  const now = useNow()
  const [lastAt, setLastAt] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!supabase) return
    const db = supabase
    let alive = true
    const load = async () => {
      const { data } = await db
        .from('service_status')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
      if (alive) setLastAt((data as { updated_at: string }[] | null)?.[0]?.updated_at ?? null)
    }
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (lastAt === undefined) return { alive: null, lastAt: null }
  return { alive: lastAt != null && now - parseTs(lastAt) < 120_000, lastAt }
}
