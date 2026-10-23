// 참값(CHAMGAP) Supabase 권한 확인 (P1·P2) — 요구사항지시서 v2.0 CLD-02·COM-11·COM-12·COM-13
//
// 실행: node supabase/check.mjs        (Node 18 이상, 설치할 것 없음)
// 주소와 공개 키는 web/.env.local 의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 에서 읽는다.
// 1) 웹과 같은 공개 키로: 읽기·쓰기 거부·명령 허용 목록·만료
// 2) firmware/node/secrets.h 에 DEVICE_KEY 가 있으면 ESP32와 같은 요청으로: 기기 키 쓰기, 명령 가져가기·결과 적기
// 남는 것: node 'TEST' 명령 몇 줄 (실제 ESP32는 가져가지 않고, 7일 뒤 자동 정리가 지운다).
//         측정값·구역 상태는 구역 이름을 일부러 규칙 밖('TEST!')으로 보내 권한만 확인하고 행은 남기지 않는다

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

let env
try {
  env = readEnv(join(root, 'web', '.env.local'))
} catch {
  console.error('web/.env.local 이 없습니다. web/.env.example 을 복사해 채워 주세요.')
  process.exit(2)
}
const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
const key = env.VITE_SUPABASE_ANON_KEY ?? ''
if (!url.startsWith('https://') || !key || key.includes('...')) {
  console.error('web/.env.local 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 비어 있습니다.')
  process.exit(2)
}

// ESP32 기기 키 (없으면 기기 확인은 건너뛴다)
function readDeviceKey() {
  try {
    const text = readFileSync(join(root, 'firmware', 'node', 'secrets.h'), 'utf8')
    const m = text.match(/^#define\s+DEVICE_KEY\s+"([^"]*)"/m)
    return m && /^[0-9a-f]{16,}$/.test(m[1]) ? m[1] : ''
  } catch {
    return ''
  }
}

// 새 공개 키(sb_publishable_)는 JWT가 아니라 apikey 헤더에만 넣는다. 옛 anon 키는 둘 다 넣는다
const baseHeaders = { apikey: key, 'Content-Type': 'application/json' }
if (!key.startsWith('sb_')) baseHeaders.Authorization = `Bearer ${key}`

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...baseHeaders, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, ok: res.ok, json }
}

const RETURN_ROW = { Prefer: 'return=representation' }
let failures = 0

function report(pass, name, detail) {
  if (!pass) failures++
  console.log(`${pass ? '  통과' : '  실패'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function errCode(r) {
  return r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? (r.json.code ?? '') : ''
}

function why(r) {
  const code = errCode(r)
  return `HTTP ${r.status}${code ? ` ${code}` : ''}`
}

// 거부는 "키가 틀려서"가 아니라 정해 둔 이유로 거부돼야 통과: 42501 권한(RLS), 23514 명령 제약(CHECK)
const RLS = '42501'
const CHECK = '23514'
function refusedBy(r, code) {
  return !r.ok && errCode(r) === code
}

async function main() {
  console.log(`Supabase: ${url}`)
  console.log(
    `공개 키 종류: ${key.startsWith('sb_publishable_') ? 'Publishable' : key.startsWith('sb_') ? '알 수 없음' : 'legacy anon'}\n`,
  )

  {
    const r = await rest('GET', 'nodes?select=node&limit=1')
    if (r.status === 401 || r.status === 403) {
      console.error(`공개 키가 받아들여지지 않습니다 (${why(r)}): ${JSON.stringify(r.json)}`)
      console.error('web/.env.local 의 VITE_SUPABASE_ANON_KEY 를 다시 확인하세요.')
      // fetch 연결이 남아 있을 때 process.exit() 하면 Windows Node가 죽으므로 exitCode 로 끝낸다
      process.exitCode = 2
      return
    }
  }

  console.log('[읽기] 누구나 모든 표를 읽을 수 있다')
  for (const t of ['readings', 'events', 'nodes', 'commands', 'diagnostics', 'service_status', 'latest_readings']) {
    const r = await rest('GET', `${t}?select=*&limit=1`)
    report(r.status === 200 && Array.isArray(r.json), `${t} 읽기`, why(r))
  }
  {
    const r = await rest('POST', 'rpc/history', { p_node: 'TEST', p_minutes: 60, p_bucket_s: 60 })
    report(r.status === 200 && Array.isArray(r.json), 'history() 그래프 함수', why(r))
  }
  {
    const r = await rest('GET', 'secrets?select=*')
    report(r.status !== 200, '비밀값 표(private.secrets)는 API로 안 보임', why(r))
  }
  {
    const r = await rest('POST', 'rpc/is_device', {})
    report(
      r.status === 200 && r.json === false,
      '기기 키 없으면 is_device() = false',
      `${why(r)}, 값 ${JSON.stringify(r.json)}`,
    )
  }

  console.log('\n[쓰기 거부] 기기 키 없이는 측정값·상태를 못 쓴다')
  {
    const r = await rest('POST', 'readings', { node: 'TEST', seq: 1, temp_a: 20 })
    report(refusedBy(r, RLS), 'readings 쓰기 거부', why(r))
  }
  {
    const r = await rest('POST', 'nodes', { node: 'TEST', fw: 'check' })
    report(refusedBy(r, RLS), 'nodes 쓰기 거부', why(r))
  }
  {
    const r = await rest('POST', 'events', { node: 'TEST', t: 'evt', ev: 'boot' })
    report(refusedBy(r, RLS), "events 't=evt' 쓰기 거부 (기기만)", why(r))
  }
  {
    const r = await rest('POST', 'diagnostics', { node: 'TEST', code: 'X', sensor: 'x', severity: 'info', title: 'x' })
    report(refusedBy(r, RLS), 'diagnostics 쓰기 거부 (진단 서버만)', why(r))
  }

  console.log('\n[명령] 허용 목록만 넣을 수 있다')
  for (const cmd of ['pump 1000', 'help', 'water 10; reboot']) {
    const r = await rest('POST', 'commands', { node: 'TEST', cmd })
    report(refusedBy(r, CHECK), `'${cmd}' 거부`, why(r))
  }

  // 상태·시각을 속여 넣어도 트리거가 pending·지금 시각으로 바꾼다
  const forged = {
    node: 'TEST',
    cmd: 'water 10',
    status: 'done',
    created_at: '2020-01-01T00:00:00Z',
    result: { ok: 1 },
  }
  const ins = await rest('POST', 'commands', forged, RETURN_ROW)
  const row = Array.isArray(ins.json) ? ins.json[0] : null
  report(ins.status === 201 && row, "'water 10' 넣기 허용", why(ins))
  if (row) {
    const ageS = (Date.now() - Date.parse(row.created_at)) / 1000
    report(row.status === 'pending' && row.result === null, '넣을 때 상태를 속여도 pending', `status=${row.status}`)
    report(Math.abs(ageS) < 60, '넣을 때 시각을 속여도 Supabase 시각', `${ageS.toFixed(1)}초 전`)

    const upd = await rest('PATCH', `commands?id=eq.${row.id}`, { status: 'done' }, RETURN_ROW)
    report(Array.isArray(upd.json) && upd.json.length === 0, '기기 키 없이 명령 상태 바꾸기 안 됨', why(upd))
    const del = await rest('DELETE', `commands?id=eq.${row.id}`, undefined, RETURN_ROW)
    report(refusedBy(del, RLS) || (Array.isArray(del.json) && del.json.length === 0), '명령 지우기 안 됨', why(del))

    // 매분 도는 pg_cron 이 10초 넘은 pending 을 expired 로 바꾼다 → 최대 약 70초 기다린다
    process.stdout.write('\n[만료] 아무도 안 가져간 명령이 expired 로 바뀌는지 기다리는 중')
    const started = Date.now()
    let last = row
    while (Date.now() - started < 90_000) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      process.stdout.write('.')
      const r = await rest('GET', `commands?id=eq.${row.id}&select=status,created_at,done_at`)
      if (Array.isArray(r.json) && r.json[0]) last = r.json[0]
      if (last.status !== 'pending') break
    }
    console.log('')
    const tookS = last.done_at ? (Date.parse(last.done_at) - Date.parse(last.created_at)) / 1000 : NaN
    report(
      last.status === 'expired',
      '10초 넘은 명령 expired',
      last.status === 'expired' ? `만든 뒤 ${tookS.toFixed(0)}초에 바뀜 (매분 검사)` : `status=${last.status}`,
    )
  }

  await deviceChecks()

  console.log(failures === 0 ? '\n모두 통과했습니다.' : `\n실패 ${failures}개 — 위 '실패' 줄을 확인하세요.`)
  process.exitCode = failures === 0 ? 0 : 1
}

// ESP32(node.ino·cloud.h)가 보내는 것과 같은 요청
async function deviceChecks() {
  const deviceKey = readDeviceKey()
  if (!deviceKey) {
    console.log('\n[기기] firmware/node/secrets.h 에 DEVICE_KEY 가 없어 건너뜁니다')
    return
  }
  const DEV = { 'x-device-key': deviceKey }
  console.log('\n[기기] ESP32와 같은 요청 (기기 키)')
  {
    const r = await rest('POST', 'rpc/is_device', {}, DEV)
    report(r.status === 200 && r.json === true, 'DEVICE_KEY 가 맞음 (is_device() = true)', why(r))
  }

  // 구역 이름 'TEST!'는 규칙(대문자·숫자·_-)에 어긋난다 → 권한(RLS)을 통과해야만 이름 규칙(23514)에서 멈춘다. 행은 안 남는다
  const reading = {
    node: 'TEST!',
    ms: 20111,
    seq: 4,
    sht_a_ok: 1,
    temp_a: 23.4,
    rh_a: 45.1,
    sht_b_ok: null,
    temp_b: null,
    rh_b: null,
    soil_a_mv: 2400,
    soil_a: 0.077,
    soil_b_mv: 1800,
    soil_b: 0.538,
    hx_ok: 1,
    weight_g: null,
    weight_sd: null,
    weight_raw: 94750,
    v12: null,
    leak: null,
    pump: 0,
    rssi: -55,
  }
  {
    const r = await rest('POST', 'readings', reading, { ...DEV, Prefer: 'return=minimal' })
    report(refusedBy(r, CHECK), 'readings: 기기 키로 권한 통과, 펌웨어 data 키가 모두 표의 열', why(r))
  }
  {
    const body = { node: 'TEST!', fw: 'node-2.1', info: { t: 'info' }, pump: 0, day_ml: 0 }
    const prefer = 'resolution=merge-duplicates,return=minimal'
    const r = await rest('POST', 'nodes?on_conflict=node', body, { ...DEV, Prefer: prefer })
    report(refusedBy(r, CHECK), 'nodes: 기기 키로 구역 상태 쓰기 권한 통과', why(r))
  }

  // 명령 가져가기·결과 적기 (schema.sql 의 claim_command·finish_command)
  const claim = (headers = DEV) => rest('POST', 'rpc/claim_command', { p_node: 'TEST' }, headers)
  const finish = (id, ok, result) => rest('POST', 'rpc/finish_command', { p_id: id, p_ok: ok, p_result: result }, DEV)
  const getCmd = async (id) => (await rest('GET', `commands?id=eq.${id}&select=*`)).json?.[0]
  const add = async (cmd) => (await rest('POST', 'commands', { node: 'TEST', cmd }, RETURN_ROW)).json?.[0]
  const first = (r) => (Array.isArray(r.json) ? r.json[0] : undefined)

  {
    const r = await claim({})
    if (r.status === 404) {
      report(false, 'claim_command 함수가 없음', 'supabase/schema.sql 을 SQL Editor에서 다시 실행하세요')
      return
    }
    report(refusedBy(r, RLS), '기기 키 없이 명령 가져가기 거부', why(r))
  }
  // 앞선 시험에서 남은 TEST 명령 정리
  for (let k = 0; k < 10; k++) {
    const left = first(await claim())
    if (!left) break
    await finish(left.id, false, { msg: 'check_drain' })
  }

  const water = await add('water 10')
  const info = await add('info')
  const stop = await add('stop')
  if (!water || !info || !stop) return report(false, '시험 명령 넣기', '')

  const got1 = first(await claim())
  report(got1?.id === stop.id && got1?.status === 'sent', 'stop 이 먼저 (COM-11)', `${got1?.cmd} → ${got1?.status}`)
  report((await getCmd(water.id))?.status === 'expired', 'stop 이 오면 대기 중인 water 는 expired', '')
  const ack = { t: 'ack', node: 'TEST', ms: 1, cmd: 'stop', ok: 1, msg: 'not running' }
  const f1 = await finish(stop.id, true, ack)
  const s1 = await getCmd(stop.id)
  report(
    f1.json === true && s1?.status === 'done' && s1?.result?.cmd === 'stop',
    '결과 적기 → done + result',
    `status=${s1?.status}`,
  )

  const got2 = first(await claim())
  report(got2?.id === info.id, '다음은 info (stop 이 아닌 명령은 그대로 둠)', got2?.cmd)
  if (got2) {
    await finish(got2.id, false, { ...ack, cmd: 'info', ok: 0, msg: 'test' })
    report((await getCmd(got2.id))?.status === 'failed', 'ok=0 이면 failed', '')
  }
  const again = await finish(stop.id, true, ack)
  report(again.json === false, '이미 끝난 명령에 다시 적기 안 됨', JSON.stringify(again.json))

  const old = await add('info')
  process.stdout.write('  (만료 확인: 11초 기다리는 중)')
  await new Promise((resolve) => setTimeout(resolve, 11_000))
  console.log('')
  const c3 = await claim()
  report(
    Array.isArray(c3.json) && c3.json.length === 0 && (await getCmd(old.id))?.status === 'expired',
    '10초 넘은 명령은 ESP32가 가져갈 때 바로 expired (COM-12)',
    why(c3),
  )
}

await main()
