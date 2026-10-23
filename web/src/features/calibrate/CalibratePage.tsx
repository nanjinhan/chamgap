import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function CalibratePage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="보정 마법사" back sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
