import type { ReactNode } from 'react'

type Props = {
  title: string
  /** 예전 화면 호환용 (뒤로 버튼은 이제 맨 위 TopBar에 있다) */
  back?: boolean | string
  right?: ReactNode
  sub?: ReactNode
}

/** 하위 화면 제목 (새 디자인: 큰 흰 글자). 뒤로 버튼은 TopBar가 맡는다 */
export function ScreenHeader({ title, right, sub }: Props) {
  return (
    <header className="mt-6 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[34px] leading-tight font-light tracking-[-0.02em]">{title}</h1>
        {sub ? <div className="mt-1 truncate text-[13px] text-ds-text-2">{sub}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  )
}
