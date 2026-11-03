import type { LiveEvent } from '@/store/useAppStore'
import { reasonText } from './commands'
import { hm, kstDay } from './history'
import { parseTs } from './nodeState'

/** 최근 활동 한 줄 (디자인 02 '최근 활동'). 진단 문구는 진단 서버가 준 것만 쓴다 */
export type Activity = {
  id: string
  at: number
  time: string // HH:MM
  day: string // YYYY-MM-DD
  icon: 'drop' | 'gear' | 'chart' | 'power' | 'note' | 'stop'
  title: string
  desc: string
}

const num = (v: unknown) => (typeof v === 'number' ? v : null)

export function toActivity(e: LiveEvent): Activity | null {
  const p = e.payload
  const at = parseTs(e.time)
  const base = { id: e.id, at, time: hm(at), day: kstDay(at) }
  if (e.kind === 'evt') {
    if (p.ev === 'pump_off') {
      const ml = num(p.ml)
      const ran = num(p.ran)
      if (p.reason === 'done') {
        return {
          ...base,
          icon: 'drop',
          title: '급수 완료',
          desc:
            ml != null
              ? `${ml.toFixed(1)} mL의 물이 공급되었습니다.`
              : `펌프가 ${((ran ?? 0) / 1000).toFixed(1)}초 돌았습니다.`,
        }
      }
      return {
        ...base,
        icon: 'stop',
        title: '급수 멈춤',
        desc: reasonText(String(p.reason ?? '')) || '펌프가 멈췄습니다.',
      }
    }
    if (p.ev === 'refused')
      return { ...base, icon: 'stop', title: '급수 거부', desc: reasonText(String(p.reason ?? '')) }
    if (p.ev === 'boot') return { ...base, icon: 'power', title: '보드 다시 시작', desc: 'ESP32가 켜졌습니다.' }
    return null
  }
  if (e.kind === 'mark') return { ...base, icon: 'note', title: '메모', desc: String(p.note ?? '') }
  if (e.kind === 'diag_on')
    return { ...base, icon: 'chart', title: String(p.title ?? '진단'), desc: String(p.detail ?? '') }
  if (e.kind === 'diag_off') return { ...base, icon: 'gear', title: `해결됨: ${String(p.title ?? '진단')}`, desc: '' }
  if (e.kind === 'water_result') {
    const d = num(p.delta_g)
    return {
      ...base,
      icon: 'drop',
      title: '급수 결과',
      desc: d != null ? `무게가 ${d >= 0 ? '+' : ''}${d.toFixed(1)} g 바뀌었습니다.` : '',
    }
  }
  return null
}
