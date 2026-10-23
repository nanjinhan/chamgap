import { create } from 'zustand'

export type ToastTone = 'ok' | 'info' | 'warn' | 'fault'

export type Toast = {
  id: number
  tone: ToastTone
  title: string
  description?: string
  duration: number
}

type ToastStore = {
  items: Toast[]
  push: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number
  remove: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq
    const item: Toast = { duration: t.tone === 'fault' ? 6000 : 3500, ...t, id }
    // 최근 3개만 (8시간 켜 두어도 늘지 않게)
    set((s) => ({ items: [...s.items, item].slice(-3) }))
    return id
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}))

/** 어디서든 부르는 알림 */
export const toast = {
  ok: (title: string, description?: string) => useToasts.getState().push({ tone: 'ok', title, description }),
  info: (title: string, description?: string) => useToasts.getState().push({ tone: 'info', title, description }),
  warn: (title: string, description?: string) => useToasts.getState().push({ tone: 'warn', title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ tone: 'fault', title, description }),
}
