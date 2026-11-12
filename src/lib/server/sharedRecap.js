// Server-side read of a publicly shared season recap via the anon-callable get_shared_season_recap() RPC.
// Revoked or unknown slugs return null. Never cached, so revoking a link takes effect immediately.
import { createClient } from '@supabase/supabase-js'
import { noStoreFetch } from '../noStoreFetch'
import { isValidSlug } from '../recap'

export async function loadSharedRecap(slug) {
  if (!isValidSlug(slug)) return null
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { fetch: noStoreFetch },
      auth: { persistSession: false },
    })
    const { data, error } = await client.rpc('get_shared_season_recap', { p_slug: slug })
    if (error || !data?.recap) return null
    return data
  } catch {
    return null
  }
}
