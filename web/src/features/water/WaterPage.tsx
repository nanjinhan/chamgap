import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function WaterPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="급수" sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
