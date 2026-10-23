import { CircleCheck, CircleX, Info, TriangleAlert, WifiOff } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import type { Severity } from '@/types/api'

type Look = { label: string; text: string; soft: string; dot: string; icon: ComponentType<SVGProps<SVGSVGElement>> }

/** 상태 색 + 글자 + 아이콘 (UI-05: 색만으로 구분하지 않는다) */
export const STATUS_LOOK: Record<Severity, Look> = {
  ok: { label: '정상', text: 'text-ok', soft: 'bg-ok-soft', dot: 'bg-ok', icon: CircleCheck },
  info: { label: '정보', text: 'text-info', soft: 'bg-info-soft', dot: 'bg-info', icon: Info },
  warn: { label: '주의', text: 'text-warn', soft: 'bg-warn-soft', dot: 'bg-warn-dot', icon: TriangleAlert },
  fault: { label: '고장', text: 'text-fault', soft: 'bg-fault-soft', dot: 'bg-fault-dot', icon: CircleX },
  offline: { label: '끊김', text: 'text-offline', soft: 'bg-offline-soft', dot: 'bg-offline', icon: WifiOff },
}

/** 카드 테두리: 주의 주황, 고장 빨강 (와이어프레임 01·05) */
export const OUTLINE: Partial<Record<Severity, string>> = {
  warn: 'outline-2 outline-warn-line',
  fault: 'outline-2 outline-fault-line',
}
