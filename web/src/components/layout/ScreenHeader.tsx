import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBack } from '@/components/icons'

type Props = {
  title: string
  back?: boolean | string
  right?: ReactNode
  sub?: ReactNode
}

/** 하위 화면 맨 위 (와이어프레임 02~07): 뒤로 · 가운데 제목(17px/800) · 오른쪽 둥근 버튼 */
export function ScreenHeader({ title, back = true, right, sub }: Props) {
  const navigate = useNavigate()
  return (
    <header className="mt-3.5 grid grid-cols-[40px_1fr_40px] items-center">
      {back ? (
        <button
          type="button"
          aria-label="뒤로"
          className="flex size-10 items-center justify-center rounded-full text-ink hover:bg-white/60"
          onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
        >
          <IconBack size={20} strokeWidth={2} />
        </button>
      ) : (
        <span />
      )}
      <div className="min-w-0 text-center">
        <h1 className="truncate text-[17px] font-extrabold">{title}</h1>
        {sub ? <div className="truncate text-[12px] text-ink-2">{sub}</div> : null}
      </div>
      <div className="flex justify-end">{right}</div>
    </header>
  )
}
