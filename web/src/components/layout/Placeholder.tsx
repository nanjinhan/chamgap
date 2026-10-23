import type { ReactNode } from 'react'

/** 아직 만들지 않은 화면 자리 (마일스톤이 진행되며 채운다) */
export function Placeholder({ children }: { children?: ReactNode }) {
  return (
    <section className="card card-pad">
      <p className="card-title">준비 중</p>
      <p className="caption mt-1">{children ?? '다음 마일스톤에서 이 화면을 채웁니다.'}</p>
    </section>
  )
}
