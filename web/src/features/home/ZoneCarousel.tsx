import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFreshness, useNode } from '@/hooks/useNode'
import { cn } from '@/lib/utils'
import type { NodeId, NodeState } from '@/types/api'

const num = (v: number | null | undefined, digits: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '--'

/** 구역 카드 위 배지: 가장 나쁜 단계와 개수 ("주의 1"), 없으면 "정상" */
function badge(node: NodeState): string {
  if (!node.online) return '끊김'
  const d = node.diagnostics
  for (const [sev, label] of [
    ['fault', '고장'],
    ['warn', '주의'],
    ['info', '정보'],
  ] as const) {
    const n = d.filter((x) => x.severity === sev).length
    if (n) return `${label} ${n}`
  }
  return '정상'
}

function ZoneCard({ id }: { id: NodeId }) {
  const node = useNode(id)
  const { ago, stale } = useFreshness(node?.last_seen)
  const [photo, setPhoto] = useState(true)
  if (!node) return null
  const d = node.latest
  const connected = Object.values(node.sensors).filter((s) => s.status !== 'offline').length
  const sub = node.online
    ? `센서 ${connected}개 연결 · ${node.pump.on ? '급수 중' : '펌프 대기'}`
    : `연결 끊김 · 마지막 값 ${ago}`
  const cells = [
    ['온도', `${num(d?.temp_a, 1)}°`],
    ['습도', `${num(d?.rh_a, 0)}%`],
    ['토양', num(d?.soil_a, 2)],
    ['무게', `${num(d?.weight_g, 0)}g`],
  ]
  return (
    <Link
      to={`/zone/${id}`}
      aria-label={`${id} 구역 상세 보기`}
      className="card relative block h-[226px] w-full shrink-0 snap-center overflow-hidden"
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(140deg,#dfe9fb,#f6f9ff)' }}>
        {photo ? (
          <img src={`/zones/${id}.jpg`} alt="" className="size-full object-cover" onError={() => setPhoto(false)} />
        ) : null}
      </div>
      <div
        className={cn(
          'absolute right-3 bottom-3 left-3 rounded-[18px] px-3.5 py-3 text-white',
          node.online ? 'bg-[rgba(47,107,255,.92)]' : 'bg-[rgba(107,114,128,.92)]',
        )}
      >
        <div className="flex items-center justify-between">
          <div className="text-[17px] font-extrabold">{id} 구역</div>
          <span className="rounded-full bg-white/20 px-[9px] py-0.5 text-[11px] font-bold">{badge(node)}</span>
        </div>
        <div className="mt-px text-[11.5px] opacity-85">{sub}</div>
        <div className={cn('mt-2.5 grid grid-cols-4 gap-1.5', stale && 'opacity-60')}>
          {cells.map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] opacity-80">{k}</div>
              <div className="num text-[14px] font-bold">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  )
}

/** 구역 카드 캐러셀 (와이어프레임 01): 옆 카드가 양쪽에 살짝 보이고, 넘기면 아래 센서 목록이 바뀐다 */
export function ZoneCarousel({ ids, index, onIndex }: { ids: NodeId[]; index: number; onIndex: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null)

  const onScroll = () => {
    const el = track.current
    if (!el || !el.firstElementChild) return
    const w = (el.firstElementChild as HTMLElement).offsetWidth + 12
    const i = Math.round(el.scrollLeft / w)
    if (i !== index && i >= 0 && i < ids.length) onIndex(i)
  }

  const goTo = (i: number) => {
    const el = track.current
    const card = el?.children[i] as HTMLElement | undefined
    if (el && card) el.scrollTo({ left: card.offsetLeft - 30, behavior: 'smooth' })
  }

  // 구역 수가 바뀌어 index가 범위를 벗어나면 맞춘다
  useEffect(() => {
    if (index >= ids.length && ids.length > 0) onIndex(ids.length - 1)
  }, [ids.length, index, onIndex])

  return (
    <section aria-label="구역" className="mt-[18px]">
      <div
        ref={track}
        onScroll={onScroll}
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[30px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollPaddingInline: 30 }}
      >
        {ids.map((id) => (
          <ZoneCard key={id} id={id} />
        ))}
      </div>
      {ids.length > 1 ? (
        <div className="mt-[9px] flex justify-center gap-[5px]">
          {ids.map((id, i) => (
            <button
              key={id}
              type="button"
              aria-label={`${id} 구역 보기`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className="relative flex h-[5px] items-center after:absolute after:-inset-2 after:content-['']"
            >
              <span
                className={cn(
                  'block h-[5px] rounded-[3px] transition-all',
                  i === index ? 'w-4 bg-brand' : 'w-[5px] bg-white',
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
