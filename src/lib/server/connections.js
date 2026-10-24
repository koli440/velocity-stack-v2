// src/lib/server/connections.js
// Server-side access to public.connections. Secret columns are only readable with the service role
// (SUPABASE_SERVICE_ROLE_KEY, hosting env setting). Without it everything falls back to the legacy
// profile_secrets row, which the caller can read under RLS.

import { createClient } from '@supabase/supabase-js'
import { DEFAULT_BACKFILL_DAYS } from '../connections.js'

export function getServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Resolve a user's Intervals credentials + backfill window.
 * @param {{ supabase: any, userId: string, serviceClient?: any }} opts supabase = request-scoped (RLS) client
 * @returns {Promise<{ athleteId: string|null, apiKey: string|null, accessToken: string|null, backfillDays: number|null, status: string|null, source: 'connections'|'profile_secrets'|'none' }>}
 */
export async function loadIntervalsConnection({ supabase, userId, serviceClient = getServiceClient() }) {
  let backfillDays = DEFAULT_BACKFILL_DAYS
  let status = null

  if (serviceClient) {
    const { data } = await serviceClient
      .from('connections')
      .select('external_athlete_id, api_key, access_token, backfill_days, status')
      .eq('user_id', userId)
      .eq('provider', 'intervals')
      .maybeSingle()
    if (data) {
      backfillDays = data.backfill_days
      status = data.status
      if (data.status !== 'disconnected' && data.external_athlete_id && (data.api_key || data.access_token)) {
        return { athleteId: data.external_athlete_id, apiKey: data.api_key, accessToken: data.access_token, backfillDays, status, source: 'connections' }
      }
      if (data.status === 'disconnected') {
        return { athleteId: null, apiKey: null, accessToken: null, backfillDays, status, source: 'none' }
      }
    }
  } else {
    // Non-secret columns are readable by the caller.
    const { data } = await supabase
      .from('connections')
      .select('backfill_days, status')
      .eq('user_id', userId)
      .eq('provider', 'intervals')
      .maybeSingle()
    if (data) {
      backfillDays = data.backfill_days
      status = data.status
    }
  }

  const { data: secrets } = await supabase
    .from('profile_secrets')
    .select('intervals_athlete_id, intervals_api_key')
    .eq('user_id', userId)
    .maybeSingle()
  if (secrets?.intervals_athlete_id && secrets?.intervals_api_key && status !== 'disconnected') {
    return {
      athleteId: secrets.intervals_athlete_id,
      apiKey: secrets.intervals_api_key,
      accessToken: null,
      backfillDays,
      status,
      source: 'profile_secrets',
    }
  }
  return { athleteId: null, apiKey: null, accessToken: null, backfillDays, status, source: 'none' }
}
