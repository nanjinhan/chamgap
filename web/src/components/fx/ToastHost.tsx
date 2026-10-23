import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import SwipeToast from '@/components/react-bits/SwipeToast'
import { useToasts, type ToastTone } from '@/store/useToasts'

const ICON: Record<ToastTone, typeof Info> = { ok: CircleCheck, info: Info, warn: TriangleAlert, fault: CircleX }
const FUSE: Record<ToastTone, string> = { ok: '#16834A', info: '#2F6BFF', warn: '#E8890C', fault: '#D6334A' }
const ICON_COLOR: Record<ToastTone, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  fault: 'text-fault',
}

/**
 * 명령 결과 알림 (Swipe Toast). 하단 탭 바와 모두 정지 버튼을 가리지 않게 그 위에 쌓는다.
 * 고장 알림은 assertive, 나머지는 polite로 읽어 준다.
 */
export function ToastHost() {
  const items = useToasts((s) => s.items)
  const remove = useToasts((s) => s.remove)
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 "
      style={{ bottom: 'calc(var(--safe-bottom) + 16px + 60px + 12px)' }}
    >
      {items.map((t) => {
        const Icon = ICON[t.tone]
        return (
          <div key={t.id} className="pointer-events-auto" role={t.tone === 'fault' ? 'alert' : 'status'}>
            <SwipeToast
              inline
              open
              title={t.title}
              description={t.description}
              icon={<Icon className={`size-5 ${ICON_COLOR[t.tone]}`} aria-hidden />}
              onClose={() => remove(t.id)}
              duration={t.duration}
              background="#FFFFFF"
              color="#18213A"
              fuseColor={FUSE[t.tone]}
              width={380}
              radius={18}
              closeButton
            />
          </div>
        )
      })}
    </div>
  )
}
