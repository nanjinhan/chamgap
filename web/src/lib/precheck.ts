import type { NodeState } from '@/types/api'

/**
 * 켜기 전 점검 (SAFE-04): ESP32가 하는 검사(SAFE-03)를 마지막 값으로 미리 계산해 안내만 한다.
 * 최종 판단은 ESP32가 한다 — 여기서 통과해도 보드가 거부할 수 있다.
 */
export type PreCheck = { key: string; ok: boolean; label: string; why: string }

export function waterPrecheck(node: NodeState | undefined, ml: number) {
  const info = node?.info
  const d = node?.latest
  const limit = typeof info?.day_limit_ml === 'number' ? info.day_limit_ml : 300
  const today = node?.pump.today_ml ?? 0
  const mlps = typeof info?.pump_mlps === 'number' ? info.pump_mlps : 0
  const checks: PreCheck[] = [
    { key: 'online', ok: !!node?.online, label: '구역 연결', why: '구역이 연결돼 있지 않아요' },
    { key: 'no_pump', ok: !!node?.sensors.pump.present, label: '펌프 설치', why: '이 구역에는 펌프가 아직 없어요' },
    { key: 'already_on', ok: !node?.pump.on, label: '펌프 꺼짐', why: '이미 급수 중이에요' },
    {
      key: 'daily_limit',
      ok: today + ml <= limit,
      label: `오늘 합계 ${limit}mL 이하`,
      why: `오늘 ${Math.round(today)}mL를 줘서 ${ml}mL를 더 주면 하루 한도(${limit}mL)를 넘어요`,
    },
    { key: 'flow_uncal', ok: mlps > 0, label: '유량 보정', why: '유량 보정이 먼저예요' },
    {
      key: 'no_12v',
      ok: !(info?.v12_sense === 1 && typeof d?.v12 === 'number' && d.v12 < 9),
      label: '12V 전원',
      why: '12V 전원이 없어요 (비상정지·퓨즈 확인)',
    },
    { key: 'leak', ok: d?.leak !== 1, label: '누수 없음', why: '물이 새고 있어요' },
    {
      key: 'scale_dead',
      ok: !(node?.sensors.scale.present && d?.hx_ok === 0),
      label: '무게 센서 응답',
      why: '무게 센서가 응답하지 않아요',
    },
  ]
  return {
    ok: checks.every((c) => c.ok),
    checks,
    first: checks.find((c) => !c.ok) ?? null,
    seconds: mlps > 0 ? ml / mlps : null,
    mlps,
    today,
    limit,
  }
}
