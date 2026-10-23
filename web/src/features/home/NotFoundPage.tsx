import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function NotFoundPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="찾을 수 없는 화면" back="/" sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
