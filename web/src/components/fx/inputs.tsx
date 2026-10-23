import { Droplet, Droplets } from 'lucide-react'
import type { ReactNode } from 'react'
import ElasticSlider from '@/components/react-bits/ElasticSlider'
import GlideSelect from '@/components/react-bits/GlideSelect'
import PromptBar from '@/components/react-bits/PromptBar'
import RubberSegment from '@/components/react-bits/RubberSegment'
import SpringCheck from '@/components/react-bits/SpringCheck'
import SquishSwitch from '@/components/react-bits/SquishSwitch'
import { useReducedMotion } from '@/lib/motion'

/** 급수량 (0~50mL, 5 단위). 화살표 키로도 조절된다 (ElasticSlider role=slider) */
export function AmountSlider({
  value,
  onChange,
  max = 50,
  step = 5,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  max?: number
  step?: number
  disabled?: boolean
}) {
  const reduced = useReducedMotion()
  return (
    <div className="text-brand">
      <ElasticSlider
        value={value}
        onChange={onChange}
        maxValue={max}
        startingValue={0}
        isStepped
        stepSize={step}
        valuePosition="bubble"
        formatValue={(v) => `${Math.round(v)} mL`}
        leftIcon={<Droplet className="size-4" aria-hidden />}
        rightIcon={<Droplets className="size-5" aria-hidden />}
        ticks
        thumb
        thickness={8}
        activeThickness={12}
        maxStretch={reduced ? 0 : 40}
        bounce={reduced ? 0 : 0.4}
        trackColor="#DCE6FB"
        rangeColor="#2F6BFF"
        thumbColor="#ffffff"
        ariaLabel="급수량 (mL)"
        disabled={disabled}
        className="!w-full"
      />
    </div>
  )
}

export type SegmentItem = { value: string; label: ReactNode }

/** 알약 세그먼트 (진단 필터 등) */
export function Segment({
  items,
  value,
  onChange,
  label,
}: {
  items: SegmentItem[]
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <RubberSegment
      items={items}
      value={value}
      onChange={(v) => onChange(v)}
      trackColor="#E8EFFF"
      thumbColor="#2F6BFF"
      textColor="#4F5B76"
      activeTextColor="#FFFFFF"
      radius={999}
      size="md"
      equalSlots={false}
      aria-label={label}
    />
  )
}

/** 고르기 (기록 기간 등) */
export function PeriodSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <GlideSelect
      options={options}
      value={value}
      onChange={(v) => onChange(v)}
      accentColor="#2F6BFF"
      surfaceColor="#FFFFFF"
      highlightColor="#E8EFFF"
      textColor="#18213A"
      radius={999}
      size="sm"
      ariaLabel={label}
    />
  )
}

/** 설정 스위치 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <SquishSwitch
      checked={checked}
      onChange={onChange}
      ariaLabel={label}
      trackColor="#DFE5F1"
      trackOnColor="#2F6BFF"
      thumbColor="#FFFFFF"
      thumbOnColor="#FFFFFF"
      width={52}
      height={30}
      radius={15}
    />
  )
}

/** 확인 방법 체크리스트 한 줄 */
export function CheckItem({
  label,
  checked,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <SpringCheck
      label={label}
      checked={checked}
      onChange={onChange}
      color="#18213A"
      fillColor="#16834A"
      checkColor="#FFFFFF"
      boxSize={22}
      boxRadius={7}
      fontSize={14}
      strike="none"
      doneOpacity={0.7}
    />
  )
}

/** 시험 모드 명령 입력 */
export function CommandBar({
  onSend,
  placeholder = '명령 입력 (예: show)',
  busy,
}: {
  onSend: (text: string) => void
  placeholder?: string
  busy?: boolean
}) {
  return (
    <PromptBar
      placeholder={placeholder}
      sources={[]}
      commands={[]}
      models={[]}
      efforts={[]}
      busy={busy}
      onSend={(text) => {
        if (text.trim()) onSend(text.trim())
      }}
      background="#FFFFFF"
      color="#18213A"
      menuBackground="#FFFFFF"
      sparkColor="#2F6BFF"
      radius={18}
      maxRows={2}
    />
  )
}
