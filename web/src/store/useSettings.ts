import { create } from 'zustand'

/** 이 기기에서만 쓰는 설정 (localStorage). 실패해도 기본값으로 동작한다. */
type Settings = {
  reducedMotion: boolean
  sound: boolean
  setReducedMotion: (v: boolean) => void
  setSound: (v: boolean) => void
}

const KEY = 'chamgap-settings'

function load(): Pick<Settings, 'reducedMotion' | 'sound'> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<Settings>
      return { reducedMotion: v.reducedMotion === true, sound: v.sound === true }
    }
  } catch {
    // 저장소를 쓸 수 없는 환경 (사생활 보호 모드 등)
  }
  return { reducedMotion: false, sound: false }
}

function save(s: Pick<Settings, 'reducedMotion' | 'sound'>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 무시
  }
}

export const useSettings = create<Settings>((set, get) => ({
  ...load(),
  setReducedMotion: (reducedMotion) => {
    set({ reducedMotion })
    save({ reducedMotion, sound: get().sound })
  },
  setSound: (sound) => {
    set({ sound })
    save({ reducedMotion: get().reducedMotion, sound })
  },
}))
