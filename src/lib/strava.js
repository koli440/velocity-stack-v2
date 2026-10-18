// src/lib/strava.js
// Pure Strava helpers (#109 step 5): OAuth state signing, token decisions, stream mapping, webhook
// event parsing, rate-limit parsing. No network or DB access here.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const STRAVA_SCOPE = 'activity:read_all'
export const STATE_TTL_S = 600
export const TOKEN_REFRESH_SKEW_S = 300
export const STRAVA_RIDE_TYPES = ['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide', 'Handcycle']
export const STRAVA_STREAM_KEYS = 'time,watts,cadence,heartrate,velocity_smooth,latlng,altitude,distance'

export function isStravaConfigured(env = process.env) {
  return !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET)
}

// ---- OAuth state: base64url(payload).hmac, bound to the user and expiring ----

function b64(buf) {
  return Buffer.from(buf).toString('base64url')
}

function mac(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signState({ userId, secret, now = Date.now(), ttlS = STATE_TTL_S, nonce = randomBytes(8).toString('hex'), returnTo }) {
  if (!userId || !secret) throw new Error('userId and secret are required')
  const body = { u: userId, e: Math.floor(now / 1000) + ttlS, n: nonce }
  if (returnTo === 'home') body.r = 'home'
  const payload = b64(JSON.stringify(body))
  return `${payload}.${mac(secret, payload)}`
}

/** @returns {{ ok: true, userId: string } | { ok: false, reason: 'malformed'|'bad_signature'|'expired' }} */
export function verifyState({ state, secret, now = Date.now() }) {
  if (typeof state !== 'string' || !secret) return { ok: false, reason: 'malformed' }
  const [payload, sig, ...rest] = state.split('.')
  if (!payload || !sig || rest.length) return { ok: false, reason: 'malformed' }
  const a = Buffer.from(sig)
  const b = Buffer.from(mac(secret, payload))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }
  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!data?.u || typeof data.e !== 'number') return { ok: false, reason: 'malformed' }
  if (data.e * 1000 < now) return { ok: false, reason: 'expired' }
  return data.r === 'home' ? { ok: true, userId: data.u, returnTo: 'home' } : { ok: true, userId: data.u }
}

/** Where the OAuth callback sends the browser: the dashboard when the flow started there, else Settings. */
export function stravaReturnPath(returnTo) {
  return returnTo === 'home' ? '/' : '/settings'
}

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const qs = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  })
  return `https://www.strava.com/oauth/authorize?${qs}`
}

/** Strava returns the granted scopes comma-separated; at least activity read access is required. */
export function hasRequiredScope(scope) {
  const granted = String(scope || '').split(/[,\s]+/)
  return granted.includes('activity:read_all') || granted.includes('activity:read')
}

// ---- Tokens ----

export function tokenNeedsRefresh(expiresAt, now = Date.now(), skewS = TOKEN_REFRESH_SKEW_S) {
  if (!expiresAt) return true
  const t = new Date(expiresAt).getTime()
  if (Number.isNaN(t)) return true
  return t - now <= skewS * 1000
}

/** Strava token response -> connections columns. */
export function tokensToColumns(resp) {
  if (!resp?.access_token || !resp?.refresh_token) return null
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    token_expires_at: new Date((Number(resp.expires_at) || 0) * 1000).toISOString(),
  }
}

/** Refresh failures that mean the user must reconnect (revoked / invalid grant). */
export function isRevokedGrant(status, body) {
  if (status === 400 || status === 401) return true
  const errs = Array.isArray(body?.errors) ? body.errors : []
  return errs.some((e) => e?.field === 'refresh_token' || e?.code === 'invalid')
}

// ---- Activities / streams ----

export function isStravaRide(a) {
  const type = a?.sport_type || a?.type
  return STRAVA_RIDE_TYPES.includes(type)
}

/** Strava list item -> the shared "ride" shape used by selectNewRides. */
export function mapStravaListItem(a) {
  return {
    id: a.id,
    name: a.name,
    start_date_local: a.start_date_local ? String(a.start_date_local).replace(/Z$/, '') : null,
    start_time: a.start_date || null,
    elapsed_time_s: a.elapsed_time ?? null,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    average_watts: a.average_watts,
  }
}

export function filterStravaRides(activities) {
  return (Array.isArray(activities) ? activities : []).filter(isStravaRide).map(mapStravaListItem)
}

/** Forward-fill a sparse (time-indexed) series onto a 1 Hz grid so analysis can assume 1 sample/s. */
export function resampleToSeconds(time, data) {
  if (!Array.isArray(time) || !Array.isArray(data) || !time.length) return Array.isArray(data) ? data : []
  const n = Math.floor(time[time.length - 1] - time[0]) + 1
  const out = new Array(n)
  let j = 0
  for (let s = 0; s < n; s++) {
    while (j + 1 < time.length && time[j + 1] - time[0] <= s) j++
    out[s] = data[j] ?? null
  }
  return out
}

/**
 * Strava streams (`key_by_type=true` object, or an array of {type,data}) -> the
 * [{ type, data, data2? }] list analyzeStreams expects, resampled to 1 Hz.
 */
export function stravaStreamsToList(streams) {
  const byType = Array.isArray(streams)
    ? Object.fromEntries(streams.filter((s) => s?.type).map((s) => [s.type, s]))
    : streams || {}
  const time = byType.time?.data
  const list = []
  for (const type of ['watts', 'cadence', 'heartrate', 'velocity_smooth', 'altitude', 'distance']) {
    const data = byType[type]?.data
    if (Array.isArray(data) && data.length) list.push({ type, data: resampleToSeconds(time, data) })
  }
  const latlng = byType.latlng?.data
  if (Array.isArray(latlng) && latlng.length) {
    const grid = resampleToSeconds(time, latlng)
    list.push({
      type: 'latlng',
      data: grid.map((p) => (Array.isArray(p) ? p[0] : null)),
      data2: grid.map((p) => (Array.isArray(p) ? p[1] : null)),
    })
  }
  return list
}

/** `after` query value (epoch seconds) for a YYYY-MM-DD lower bound; undefined = full history. */
export function afterEpoch(oldest) {
  if (!oldest) return undefined
  const t = new Date(`${oldest}T00:00:00Z`).getTime()
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000)
}

// ---- Webhooks ----

/**
 * @returns {{ kind: 'activity', aspect: 'create'|'update'|'delete', activityId: string, athleteId: string }
 *   | { kind: 'deauthorized', athleteId: string } | { kind: 'ignore' }}
 */
export function parseWebhookEvent(body) {
  if (!body || typeof body !== 'object') return { kind: 'ignore' }
  const athleteId = body.owner_id != null ? String(body.owner_id) : null
  if (!athleteId) return { kind: 'ignore' }
  if (body.object_type === 'athlete') {
    return String(body.updates?.authorized) === 'false' ? { kind: 'deauthorized', athleteId } : { kind: 'ignore' }
  }
  if (body.object_type === 'activity' && body.object_id != null && ['create', 'update', 'delete'].includes(body.aspect_type)) {
    return { kind: 'activity', aspect: body.aspect_type, activityId: String(body.object_id), athleteId }
  }
  return { kind: 'ignore' }
}

/** Subscription validation (GET): echo hub.challenge only when the verify token matches. */
export function validateSubscriptionRequest({ mode, token, challenge }, expectedToken) {
  if (mode !== 'subscribe' || !challenge || !expectedToken || typeof token !== 'string') return null
  const a = Buffer.from(token)
  const b = Buffer.from(expectedToken)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { 'hub.challenge': challenge }
}

// ---- Rate limits ----

/** "100,1000" -> [100, 1000]; null when missing/invalid. */
function pair(v) {
  if (!v) return null
  const p = String(v).split(',').map((x) => Number(x.trim()))
  return p.length === 2 && p.every((n) => Number.isFinite(n)) ? p : null
}

export function parseRateLimit(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k])
  const limit = pair(get('x-ratelimit-limit') ?? get('X-RateLimit-Limit'))
  const usage = pair(get('x-ratelimit-usage') ?? get('X-RateLimit-Usage'))
  return limit && usage ? { limit, usage } : null
}

/** True when another call would likely exceed the 15-minute or daily window (small safety margin). */
export function isRateLimitNear(rl, margin = 3) {
  if (!rl) return false
  return rl.usage[0] >= rl.limit[0] - margin || rl.usage[1] >= rl.limit[1] - margin
}
