// Browser-side helpers for the connections API, shared by Settings and the empty-feed welcome card.
import { supabase, getAuthHeader } from './supabase'
import { parseJsonResponse } from './httpJson'
import { CONNECTION_PUBLIC_COLUMNS, DEFAULT_BACKFILL_DAYS } from './connections'

async function call(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await parseJsonResponse(res)
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const callIntervals = (method, body) => call('/api/connections/intervals', method, body)
export const callStrava = (method, body) => call('/api/connections/strava', method, body)
export const callWahoo = (method, body) => call('/api/connections/wahoo', method, body)

/** Starts the Strava OAuth round trip; `returnTo: 'home'` brings the rider back to the dashboard. */
export async function startStravaAuthorize({ returnTo } = {}) {
  const res = await fetch(`/api/connections/strava/authorize${returnTo === 'home' ? '?return=home' : ''}`, {
    headers: await getAuthHeader(),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Strava authorization')
  window.location.href = data.url
}

/** Starts the Intervals.icu OAuth round trip; `returnTo: 'home'` brings the rider back to the dashboard. */
export async function startIntervalsAuthorize({ returnTo } = {}) {
  const res = await fetch(`/api/connections/intervals/authorize${returnTo === 'home' ? '?return=home' : ''}`, {
    headers: await getAuthHeader(),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Intervals.icu authorization')
  window.location.href = data.url
}

/** Starts the Wahoo OAuth round trip; `returnTo: 'home'` brings the rider back to the dashboard. */
export async function startWahooAuthorize({ returnTo } = {}) {
  const res = await fetch(`/api/connections/wahoo/authorize${returnTo === 'home' ? '?return=home' : ''}`, {
    headers: await getAuthHeader(),
  })
  const data = await parseJsonResponse(res)
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Wahoo authorization')
  window.location.href = data.url
}

/** Triggers a sync for 'strava' | 'intervals' | 'wahoo'. Returns { status, data }. */
export async function runProviderSync(provider) {
  const res = await fetch(`/api/sync/${provider}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: '{}',
  })
  const data = await parseJsonResponse(res)
  return { ok: res.ok, status: res.status, data }
}

/** Reads one provider's connection row, counting legacy Intervals credentials as connected. */
export async function fetchConnection(userId, provider) {
  const { data } = await supabase
    .from('connections')
    .select(CONNECTION_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (data || provider !== 'intervals') return data
  const { data: legacy } = await supabase
    .from('profile_secrets')
    .select('intervals_athlete_id, intervals_api_key')
    .eq('user_id', userId)
    .maybeSingle()
  if (legacy?.intervals_athlete_id && legacy?.intervals_api_key) {
    return { provider: 'intervals', status: 'active', auth_method: 'api_key', external_athlete_id: legacy.intervals_athlete_id, backfill_days: DEFAULT_BACKFILL_DAYS }
  }
  return null
}
