import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function SettingsPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="설정" back sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
