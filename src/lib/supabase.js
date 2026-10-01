import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Builds an Authorization header carrying the current user's access token.
 * Our API routes run server-side and can't read this client's session
 * (it's persisted in localStorage, not cookies), so any fetch() call that
 * hits an authenticated route must attach this header explicitly.
 */
export async function getAuthHeader() {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {}
}
