import { useParams } from 'react-router-dom'
import { Placeholder } from '@/components/layout/Placeholder'
import { ScreenHeader } from '@/components/layout/ScreenHeader'

export default function DiagnosticsPage() {
  const params = useParams()
  return (
    <>
      <ScreenHeader title="진단 목록" sub={Object.values(params).join(' · ') || undefined} />
      <Placeholder />
    </>
  )
}
