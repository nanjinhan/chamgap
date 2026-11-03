import { Link } from 'react-router-dom'
import { Panel } from '@/components/ds/ui'

export default function NotFoundPage() {
  return (
    <div className="mt-8 pl-2">
      <div className="text-[13px] tracking-[0.1em] text-ds-text-3">NOT FOUND</div>
      <h1 className="mt-2 text-[30px] font-semibold">찾을 수 없는 화면이에요</h1>
      <Panel className="mt-5">
        <p className="text-[14px] text-ds-text-2">주소가 바뀌었거나 없는 화면이에요.</p>
        <Link to="/" className="mt-3 inline-block text-[14px] text-[var(--ds-lime)]">
          홈으로 가기 →
        </Link>
      </Panel>
    </div>
  )
}
