import type { NodeId } from '@/types/api'

/**
 * 구역(화분)마다 보여 줄 식물 이름과 사진. 구역을 바꾸거나 식물을 갈면 여기만 고친다.
 * 사진은 web/public/design/ (디자인 이미지에서 잘라 온 것. 더 좋은 사진으로 바꿔도 된다).
 */
export type ZoneProfile = {
  id: NodeId
  name: string // 큰 제목 (영문)
  nameKo: string
  photo: string | null
}

export const ZONES: ZoneProfile[] = [
  { id: 'Z1', name: 'Monstera', nameKo: '몬스테라', photo: '/design/plant-z1.jpg' },
  { id: 'Z2', name: 'Pothos', nameKo: '스킨답서스', photo: '/design/plant-z2.jpg' },
  { id: 'Z3', name: 'Sansevieria', nameKo: '산세베리아', photo: '/design/plant-z3.jpg' },
]

export function zoneProfile(id: NodeId): ZoneProfile {
  return ZONES.find((z) => z.id === id) ?? { id, name: id, nameKo: id, photo: null }
}

/** 화면에 늘어놓을 구역: 정해 둔 Z1~Z3 + Supabase에서 새로 보인 구역 */
export function zoneIds(seen: NodeId[]): NodeId[] {
  const extra = seen.filter((id) => !ZONES.some((z) => z.id === id)).sort()
  return [...ZONES.map((z) => z.id), ...extra]
}
