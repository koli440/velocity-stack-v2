// src/lib/supabaseServer.js
//
// The app's browser Supabase client (src/lib/supabase.js) uses
// @supabase/supabase-js's createClient, which persists the session in
// localStorage — not cookies. That means API routes cannot use
// @supabase/ssr's cookie-based createServerClient to recover the signed-in
// user; the cookie jar is always empty and auth.getUser() fails.
//
// Instead, the client attaches the user's access token as a Bearer header
// (see getAuthHeader() usages on the client), and server routes build a
// request-scoped Supabase client whose PostgREST/Auth calls carry that same
// header. This lets RLS policies resolve auth.uid() correctly and lets us
// validate the token via supabase.auth.getUser(token).
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Build a request-scoped Supabase client bound to the caller's bearer token
 * (if any), plus the resolved + verified user (or null if missing/invalid).
 */
export async function getRequestUser(req) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false },
  })

  if (!token) {
    return { supabase, user: null }
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  return { supabase, user: error ? null : user }
}
