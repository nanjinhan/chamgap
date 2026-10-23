import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function ZonePage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="구역 상세" back sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
