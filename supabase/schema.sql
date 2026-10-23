-- 참값(CHAMGAP) Supabase 준비 — 요구사항지시서 v2.0 4.4절·5장
-- Supabase 화면 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하다 (있으면 건너뛰거나 고쳐 쓴다).
-- 마지막에 나오는 device_key 값은 ESP32 secrets.h 에만 넣는다 (채팅·GitHub에 올리지 않는다).

-- ============================================================ 비밀값 (API로 안 보이는 private 스키마)

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.secrets (
  name text primary key,
  value text not null
);
insert into private.secrets (name, value)
values ('device_key', encode(extensions.gen_random_bytes(18), 'hex')),
       ('diag_key', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

-- 요청 헤더 x-device-key 가 맞으면 ESP32(또는 가짜 ESP32)로 본다
create or replace function public.is_device() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (current_setting('request.headers', true)::json ->> 'x-device-key')
      = (select s.value from private.secrets s where s.name = 'device_key'),
    false)
$$;

-- 요청 헤더 x-diag-key 가 맞으면 진단 서버로 본다 (선택 기능)
create or replace function public.is_diag() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (current_setting('request.headers', true)::json ->> 'x-diag-key')
      = (select s.value from private.secrets s where s.name = 'diag_key'),
    false)
$$;

revoke all on function public.is_device() from public;
revoke all on function public.is_diag() from public;
grant execute on function public.is_device() to anon, authenticated;
grant execute on function public.is_diag() to anon, authenticated;

-- ============================================================ 표

-- 주기 측정값 (data 메시지 한 줄 = 한 행). 열 이름 = 메시지 키 이름
create table if not exists public.readings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  node text not null check (node ~ '^[A-Z0-9_-]{1,16}$'),
  ms bigint,
  seq integer,
  sht_a_ok smallint, temp_a real, rh_a real,
  sht_b_ok smallint, temp_b real, rh_b real,
  soil_a_mv integer, soil_a real,
  soil_b_mv integer, soil_b real,
  hx_ok smallint, weight_g real, weight_sd real, weight_raw bigint,
  v12 real, leak smallint, pump smallint, rssi integer,
  extra jsonb -- 표에 없는 키 (COM-09)
);
create index if not exists readings_node_time on public.readings (node, created_at desc);

-- 사건: ESP32의 evt·info, 웹의 메모, 진단 서버의 diag_on/off·water_result
create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  node text,
  t text not null check (t in ('evt', 'info', 'mark', 'diag_on', 'diag_off', 'water_result')),
  ev text,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists events_node_time on public.events (node, created_at desc);

-- 구역별 마지막 상태·보정값 (ESP32가 upsert)
create table if not exists public.nodes (
  node text primary key check (node ~ '^[A-Z0-9_-]{1,16}$'),
  updated_at timestamptz not null default now(),
  last_seen timestamptz,
  fw text,
  info jsonb,
  pump smallint not null default 0,
  day_ml real not null default 0
);

-- 명령: 웹이 pending 으로 넣고 → ESP32가 sent → done/failed/expired
create table if not exists public.commands (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  node text not null check (node ~ '^[A-Z0-9_-]{1,16}$'),
  cmd text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'done', 'failed', 'expired')),
  picked_at timestamptz,
  done_at timestamptz,
  result jsonb
);
create index if not exists commands_node_status on public.commands (node, status, created_at);

-- 웹이 넣을 수 있는 명령만 (COM-13): pump·help 는 막는다
alter table public.commands drop constraint if exists commands_cmd_allowed;
-- (정규식은 한 문자열로: PostgreSQL에서 ~ 와 || 는 우선순위가 같아 나눠 이으면 잘못 묶인다)
alter table public.commands add constraint commands_cmd_allowed check (
  lower(cmd) ~ '^(status|info|stop|reboot|tare|water [0-9]+(\.[0-9]+)?|cal [0-9]+(\.[0-9]+)?|soilcal [ab] (air|wet)|flow [0-9]+ [0-9]+(\.[0-9]+)?|flowcal [0-9]+|interval [0-9]+|id [a-z0-9_-]{1,16})$'
);

-- 진단 (선택: 진단 서버가 지금 활성인 진단만 유지)
create table if not exists public.diagnostics (
  node text not null,
  code text not null,
  sensor text not null,
  severity text not null check (severity in ('info', 'warn', 'fault', 'offline')),
  title text not null,
  detail text not null default '',
  causes jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  since timestamptz not null default now(),
  action jsonb,
  "values" jsonb,
  updated_at timestamptz not null default now(),
  primary key (node, code, sensor)
);

-- 진단 서버가 켜져 있는지 (선택)
create table if not exists public.service_status (
  name text primary key,
  updated_at timestamptz not null default now(),
  info jsonb
);

-- ============================================================ 시각은 Supabase 기준 (COM-08)

-- 넣는 쪽이 created_at 을 마음대로 정하지 못하게 한다 (명령 10초 만료가 무너지지 않게)
create or replace function private.stamp_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if tg_table_name = 'commands' then
    new.status := 'pending';
    new.picked_at := null;
    new.done_at := null;
    new.result := null;
  end if;
  return new;
end $$;

drop trigger if exists readings_stamp on public.readings;
create trigger readings_stamp before insert on public.readings for each row execute function private.stamp_insert();
drop trigger if exists events_stamp on public.events;
create trigger events_stamp before insert on public.events for each row execute function private.stamp_insert();
drop trigger if exists commands_stamp on public.commands;
create trigger commands_stamp before insert on public.commands for each row execute function private.stamp_insert();

-- ============================================================ 권한 (RLS, CLD-02)
-- 누구나 읽기 O. 웹(anon)은 명령 넣기·메모만. 나머지 쓰기는 기기 키·진단 키가 맞을 때만.

-- 표 권한을 직접 준다 ("Automatically expose new tables"를 꺼도 동작하게). 실제 허용 범위는 아래 RLS 정책이 정한다
grant usage on schema public to anon, authenticated;
grant select on public.readings, public.events, public.nodes, public.commands, public.diagnostics,
  public.service_status to anon, authenticated;
grant insert on public.readings, public.events, public.nodes, public.commands to anon, authenticated;
grant update on public.nodes, public.commands to anon, authenticated;
grant insert, update, delete on public.diagnostics, public.service_status to anon, authenticated;

alter table public.readings enable row level security;
alter table public.events enable row level security;
alter table public.nodes enable row level security;
alter table public.commands enable row level security;
alter table public.diagnostics enable row level security;
alter table public.service_status enable row level security;

do $$
declare t text;
begin
  foreach t in array array['readings', 'events', 'nodes', 'commands', 'diagnostics', 'service_status'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
end $$;

drop policy if exists readings_device_insert on public.readings;
create policy readings_device_insert on public.readings for insert to anon, authenticated
  with check (public.is_device());

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to anon, authenticated
  with check (
    (t = 'mark')
    or (t in ('evt', 'info') and public.is_device())
    or (t in ('diag_on', 'diag_off', 'water_result') and public.is_diag())
  );

drop policy if exists nodes_device_insert on public.nodes;
create policy nodes_device_insert on public.nodes for insert to anon, authenticated
  with check (public.is_device());
drop policy if exists nodes_device_update on public.nodes;
create policy nodes_device_update on public.nodes for update to anon, authenticated
  using (public.is_device()) with check (public.is_device());

drop policy if exists commands_web_insert on public.commands;
create policy commands_web_insert on public.commands for insert to anon, authenticated
  with check (true); -- 상태·시각은 트리거가 정하고, 명령 종류는 CHECK 제약이 막는다
drop policy if exists commands_device_update on public.commands;
create policy commands_device_update on public.commands for update to anon, authenticated
  using (public.is_device()) with check (public.is_device());

drop policy if exists diagnostics_diag_write on public.diagnostics;
create policy diagnostics_diag_write on public.diagnostics for all to anon, authenticated
  using (public.is_diag()) with check (public.is_diag());
drop policy if exists service_status_diag_write on public.service_status;
create policy service_status_diag_write on public.service_status for all to anon, authenticated
  using (public.is_diag()) with check (public.is_diag());

-- 삭제는 아무도 못 한다 (정책 없음 = 거부). 오래된 기록은 아래 자동 정리가 지운다.

-- ============================================================ ESP32용 함수 (P2)
-- 시각 판단은 모두 Supabase 시계로 한다 (ESP32 시계가 아직 안 맞아도 10초 만료가 정확하게)

-- 명령 하나 가져가기: 10초 넘은 것은 expired, stop 이 먼저. stop 이면 대기 중인 water·flowcal 은 expired (COM-11·COM-12)
create or replace function public.claim_command(p_node text)
returns setof public.commands
language plpgsql set search_path = '' as $$
declare
  c public.commands;
begin
  if not public.is_device() then
    raise exception 'device key required' using errcode = '42501';
  end if;
  update public.commands set status = 'expired', done_at = now()
   where node = p_node and status = 'pending'
     and created_at < now() - interval '10 seconds' and lower(cmd) <> 'stop';
  select * into c from public.commands
   where node = p_node and status = 'pending'
   order by (lower(cmd) = 'stop') desc, created_at, id
   limit 1
   for update skip locked;
  if not found then
    return;
  end if;
  if lower(c.cmd) = 'stop' then
    update public.commands set status = 'expired', done_at = now()
     where node = p_node and status = 'pending' and id <> c.id
       and (lower(cmd) like 'water %' or lower(cmd) like 'flowcal %');
  end if;
  update public.commands set status = 'sent', picked_at = now() where id = c.id returning * into c;
  return next c;
end $$;

-- 결과 적기: ack 를 result 에 넣고 done/failed
create or replace function public.finish_command(p_id bigint, p_ok boolean, p_result jsonb)
returns boolean
language plpgsql set search_path = '' as $$
begin
  if not public.is_device() then
    raise exception 'device key required' using errcode = '42501';
  end if;
  update public.commands
     set status = case when p_ok then 'done' else 'failed' end, done_at = now(), result = p_result
   where id = p_id and status = 'sent';
  return found;
end $$;

revoke all on function public.claim_command(text) from public;
revoke all on function public.finish_command(bigint, boolean, jsonb) from public;
grant execute on function public.claim_command(text) to anon, authenticated;
grant execute on function public.finish_command(bigint, boolean, jsonb) to anon, authenticated;

-- nodes: 시각은 Supabase 가 붙인다
create or replace function private.stamp_node() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.last_seen := now();
  return new;
end $$;

drop trigger if exists nodes_stamp on public.nodes;
create trigger nodes_stamp before insert or update on public.nodes for each row execute function private.stamp_node();

-- 측정값이 들어오면 그 구역의 last_seen·pump 를 갱신한다 (ESP32가 따로 요청하지 않아도 되게)
create or replace function private.touch_node() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.nodes (node, pump) values (new.node, coalesce(new.pump, 0))
  on conflict (node) do update set pump = excluded.pump;
  return null;
end $$;

drop trigger if exists readings_touch_node on public.readings;
create trigger readings_touch_node after insert on public.readings for each row execute function private.touch_node();

-- ============================================================ 실시간 (Realtime)

do $$
declare t text;
begin
  foreach t in array array['readings', 'events', 'nodes', 'commands', 'diagnostics'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================ 화면용 조회

-- 구역별 마지막 측정값 (웹 첫 화면)
create or replace view public.latest_readings with (security_invoker = true) as
  select distinct on (node) *
  from public.readings
  order by node, created_at desc;
grant select on public.latest_readings to anon, authenticated;

-- 그래프용 평균 (CLD-05): bucket_s 초 단위 평균, null 은 평균에서 빠진다
create or replace function public.history(p_node text, p_minutes integer default 60, p_bucket_s integer default 60)
returns table (
  ts timestamptz,
  temp_a real, rh_a real, temp_b real, rh_b real,
  soil_a real, soil_b real, soil_a_mv real, soil_b_mv real,
  weight_g real, weight_sd real, weight_raw real, v12 real
)
language sql stable set search_path = '' as $$
  select
    to_timestamp(floor(extract(epoch from r.created_at) / greatest(p_bucket_s, 5)) * greatest(p_bucket_s, 5)) as ts,
    avg(r.temp_a)::real, avg(r.rh_a)::real, avg(r.temp_b)::real, avg(r.rh_b)::real,
    avg(r.soil_a)::real, avg(r.soil_b)::real, avg(r.soil_a_mv)::real, avg(r.soil_b_mv)::real,
    avg(r.weight_g)::real, avg(r.weight_sd)::real, avg(r.weight_raw)::real, avg(r.v12)::real
  from public.readings r
  where r.node = p_node
    and r.created_at >= now() - make_interval(mins => least(greatest(p_minutes, 1), 20160))
  group by 1
  order by 1
$$;
grant execute on function public.history(text, integer, integer) to anon, authenticated;

-- ============================================================ 자동 정리 (CLD-04, pg_cron)

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('chamgap-cleanup', 'chamgap-expire');
end $$;

-- 매일 새벽 3시 17분(UTC): 14일 지난 측정값, 30일 지난 사건, 7일 지난 명령 삭제
select cron.schedule('chamgap-cleanup', '17 3 * * *', $job$
  delete from public.readings where created_at < now() - interval '14 days';
  delete from public.events where created_at < now() - interval '30 days';
  delete from public.commands where created_at < now() - interval '7 days';
$job$);

-- 매분: 10초 넘게 아무도 가져가지 않은 명령은 expired (ESP32도 스스로 무시한다, COM-12). stop 은 예외
-- 가져간 뒤 3분 넘게 결과가 없으면(도중에 ESP32가 꺼짐 등) failed
select cron.schedule('chamgap-expire', '* * * * *', $job$
  update public.commands set status = 'expired', done_at = now()
  where status = 'pending' and created_at < now() - interval '10 seconds' and lower(cmd) <> 'stop';
  update public.commands set status = 'failed', done_at = now(), result = '{"ok":0,"msg":"no_ack"}'::jsonb
  where status = 'sent' and picked_at < now() - interval '3 minutes';
$job$);

-- ============================================================ 끝: 기기 키 확인
-- 아래 결과의 device_key 를 firmware/node/secrets.h 의 DEVICE_KEY 에 넣는다.
select
  (select value from private.secrets where name = 'device_key') as device_key,
  (select value from private.secrets where name = 'diag_key') as diag_key;
