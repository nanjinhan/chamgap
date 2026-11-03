import type { NodeId } from '@/types/api'

/**
 * 구역(화분)마다 보여 줄 식물 이름·사진·참고 범위. 구역을 바꾸거나 식물을 갈면 여기만 고친다.
 * 사진은 web/public/design/ (디자인 이미지에서 잘라 온 것. 더 좋은 사진으로 바꿔도 된다).
 * 참고 범위는 화면에 "적정 범위"로 보여 주는 식물별 설정일 뿐, 웹이 고장·주의를 판정하는 데 쓰지 않는다.
 */
export type ZoneProfile = {
  id: NodeId
  name: string // 큰 제목 (영문)
  nameKo: string
  photo: string | null // 동그라미·카드용 정사각형 사진
  hero: string | null // 큰 사진 (홈·구역 상세·급수 제어)
  soilRange: [number, number] // 토양 수분 적정 범위 (0~1)
  weightRangeKg: [number, number] // 화분 무게 적정 범위 (kg)
}

export const ZONES: ZoneProfile[] = [
  {
    id: 'Z1',
    name: 'Monstera',
    nameKo: '몬스테라',
    photo: '/design/plant-z1.jpg',
    hero: '/design/home-hero.jpg',
    soilRange: [0.4, 0.8],
    weightRangeKg: [1.8, 3.2],
  },
  {
    id: 'Z2',
    name: 'Pothos',
    nameKo: '스킨답서스',
    photo: '/design/plant-z2.jpg',
    hero: '/design/plant-z2.jpg',
    soilRange: [0.4, 0.8],
    weightRangeKg: [1.0, 2.5],
  },
  {
    id: 'Z3',
    name: 'Sansevieria',
    nameKo: '산세베리아',
    photo: '/design/plant-z3.jpg',
    hero: '/design/plant-z3.jpg',
    soilRange: [0.2, 0.5],
    weightRangeKg: [1.0, 2.5],
  },
]

export function zoneProfile(id: NodeId): ZoneProfile {
  return (
    ZONES.find((z) => z.id === id) ?? {
      id,
      name: id,
      nameKo: id,
      photo: null,
      hero: null,
      soilRange: [0.4, 0.8],
      weightRangeKg: [1, 3],
    }
  )
}

/** 화면에 늘어놓을 구역: 정해 둔 Z1~Z3 + Supabase에서 새로 보인 구역 */
export function zoneIds(seen: NodeId[]): NodeId[] {
  const extra = seen.filter((id) => !ZONES.some((z) => z.id === id)).sort()
  return [...ZONES.map((z) => z.id), ...extra]
}
