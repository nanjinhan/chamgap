import type { ReactNode } from 'react'

/** 아직 새 디자인으로 만들지 않은 화면 자리 (단계가 진행되며 채운다) */
export function Placeholder({ children }: { children?: ReactNode }) {
  return (
    <section className="mt-6 rounded-[22px] border border-white/15 bg-white/[0.07] p-5 backdrop-blur-md">
      <p className="text-[15px] font-semibold">준비 중</p>
      <p className="mt-1 text-[13px] text-ds-text-2">{children ?? '다음 단계에서 새 디자인으로 이 화면을 만듭니다.'}</p>
    </section>
  )
}
