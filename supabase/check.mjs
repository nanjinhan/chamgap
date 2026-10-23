// 참값(CHAMGAP) Supabase 권한 확인 (P1) — 요구사항지시서 v2.0 CLD-02·COM-12·COM-13
//
// 실행: node supabase/check.mjs        (Node 18 이상, 설치할 것 없음)
// 주소와 공개 키는 web/.env.local 의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 에서 읽는다.
// 기기 키(device_key) 없이, 웹과 같은 공개 키로만 확인한다.
// 남는 것: 실행할 때마다 node 'TEST' 명령 1줄 (실제 ESP32는 가져가지 않고, 7일 뒤 자동 정리가 지운다)

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

  console.log(failures === 0 ? '\n모두 통과했습니다.' : `\n실패 ${failures}개 — 위 '실패' 줄을 확인하세요.`)
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
