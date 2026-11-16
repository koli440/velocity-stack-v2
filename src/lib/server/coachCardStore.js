// Server-side reads of the public coach card / directory through the anon-callable RPCs. Never cached, so
// unpublishing (or turning the flag off) takes effect immediately.
import { createClient } from '@supabase/supabase-js'
import { noStoreFetch } from '../noStoreFetch'
import { isValidSlug } from '../coachCard'

function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: noStoreFetch },
    auth: { persistSession: false },
  })
}

export async function loadCoachCard(slug) {
  const s = String(slug || '').toLowerCase()
  if (!isValidSlug(s)) return null
  try {
    const { data, error } = await anonClient().rpc('get_coach_card', { p_slug: s })
    return error || !data?.slug ? null : data
  } catch {
    return null
  }
}

export async function loadCoachDirectory({ q = '', discipline = '', offset = 0 } = {}) {
  try {
    const { data, error } = await anonClient().rpc('list_coaches', {
      p_search: q || null,
      p_discipline: discipline || null,
      p_limit: 24,
      p_offset: offset,
    })
    return error || !Array.isArray(data) ? [] : data
  } catch {
    return []
  }
}
