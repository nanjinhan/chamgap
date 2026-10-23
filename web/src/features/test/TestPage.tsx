import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function TestPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="시험 모드" sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
