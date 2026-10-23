import { useState } from 'react'
import BlurText from '@/components/react-bits/BlurText'
import DecryptedText from '@/components/react-bits/DecryptedText'
import GradientText from '@/components/react-bits/GradientText'
import RotatingText from '@/components/react-bits/RotatingText'
import ShinyText from '@/components/react-bits/ShinyText'
import { useReducedMotion } from '@/lib/motion'

const INTRO_KEY = 'chamgap-intro-shown'

function introShownOnce(): boolean {
  try {
    if (sessionStorage.getItem(INTRO_KEY)) return true
    sessionStorage.setItem(INTRO_KEY, '1')
  } catch {
    // 저장소를 못 쓰면 매번 보여 준다
  }
  return false
}

/** 홈 인사말: 처음 1번만 Blur Text. BlurText가 <p>를 그리므로 <p>·<h1> 안에 넣지 말고 <div>에 넣는다 */
export function IntroText({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion()
  const [shown] = useState(introShownOnce)
  if (reduced || shown) return <span className={className}>{text}</span>
  return <BlurText text={text} className={className} trigger="load" animateBy="words" delay={90} stepDuration={0.3} />
}

/** 부제: 3초 간격으로 바뀌는 낱말 */
export function RotatingWords({ words, className }: { words: string[]; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{words.join(' · ')}</span>
  return (
    <RotatingText
      texts={words}
      rotationInterval={3000}
      splitBy="words"
      mainClassName={className}
      effect="slide"
      direction="up"
    />
  )
}

/** 새 진단 제목: 1회, 0.6초 이내. 원래 글자만 섞어 읽기를 방해하지 않는다 */
export function DecryptTitle({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{text}</span>
  return (
    <DecryptedText
      text={text}
      animateOn="view"
      sequential
      speed={30}
      maxIterations={8}
      useOriginalCharsOnly
      className={className}
      parentClassName={className}
    />
  )
}

/** 은은한 빛: '실시간' 표시, 섬의 '급수 중' */
export function Shiny({
  text,
  className,
  tone = 'light',
}: {
  text: string
  className?: string
  tone?: 'light' | 'dark'
}) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{text}</span>
  return (
    <ShinyText
      text={text}
      className={className}
      color={tone === 'light' ? '#2F6BFF' : '#BFD3FF'}
      shineColor={tone === 'light' ? '#A9C6FF' : '#FFFFFF'}
      speed={3}
      softness={0.9}
    />
  )
}

/** 노트북 화면 제목: 파랑 계열만 */
export function GradientTitle({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced)
    return (
      <span className={className} style={{ color: 'var(--primary-brand)' }}>
        {text}
      </span>
    )
  return (
    <GradientText colors={['#2F6BFF', '#6FA0FF', '#2456D6']} animationSpeed={10} className={className}>
      {text}
    </GradientText>
  )
}
