// Anon read of a shared lab report by token. Never cached so revoking takes effect immediately.
import { createClient } from '@supabase/supabase-js'
import { noStoreFetch } from '../noStoreFetch'
import { isValidToken } from '../labReports'

export async function loadLabReport(token) {
  if (!isValidToken(token)) return null
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { fetch: noStoreFetch },
      auth: { persistSession: false },
    })
    const { data, error } = await client.rpc('lab_report_public', { p_token: token })
    return error || !data?.snapshot ? null : data
  } catch {
    return null
  }
}
