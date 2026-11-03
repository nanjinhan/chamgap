import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase 접속 하나를 앱 전체가 쓴다 (요구사항 UI-12).
 * 주소·공개 키는 환경변수로만 받는다: 개발은 web/.env.local, 배포는 Vercel 환경변수.
 * 공개 키(Publishable/anon)라 화면 코드에 들어가도 되고, 쓰기 권한은 schema.sql 의 RLS가 막는다.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 설정이 비었으면 화면에 보여 줄 문장, 정상이면 null */
export const configError: string | null =
  !url || !url.startsWith('https://') || !key || key.includes('...')
    ? 'Supabase 주소·공개 키가 없어요 (web/.env.local 또는 Vercel 환경변수의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)'
    : null

export const supabase: SupabaseClient | null = configError
  ? null
  : createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false }, // 로그인 없음
      realtime: { params: { eventsPerSecond: 20 } },
    })
