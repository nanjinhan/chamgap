import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function SensorPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="센서 상세" back sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
