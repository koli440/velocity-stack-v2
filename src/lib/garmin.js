// src/lib/garmin.js
// Pure Garmin Connect Developer Program helpers (#310): OAuth2 PKCE URLs/tokens, push-payload parsing, sport filter.
// No network or DB access here. OAuth state signing is shared with Strava (src/lib/strava.js).
// Garmin Starter access is push-only: Garmin sends new activities to our webhook, there is no history to read.
// Endpoints follow Garmin's "OAuth2 PKCE 2.0", "Activity API 2.1" and "Training API V2 2.0" documents; they stay
// overridable by env (GARMIN_AUTHORIZE_URL, GARMIN_TOKEN_URL, GARMIN_API_BASE) for testing.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const GARMIN_AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm'
export const GARMIN_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token'
export const GARMIN_API = 'https://apis.garmin.com'
// Registered in the Garmin developer portal, so it is fixed (not derived from the request host).
export const GARMIN_REDIRECT_URI = 'https://www.velocity-stack.app/api/connections/garmin/callback'
export const GARMIN_PKCE_COOKIE = 'garmin_pkce'
export const GARMIN_PKCE_TTL_S = 600
// Access tokens last 24 h; Garmin recommends refreshing 600 s or more early.
export const GARMIN_TOKEN_REFRESH_SKEW_S = 600
export const GARMIN_PERMISSION_ACTIVITY = 'ACTIVITY_EXPORT'
export const GARMIN_PERMISSION_WORKOUT = 'WORKOUT_IMPORT'

export { NO_HISTORY_NOTE } from './garminCopy.js'

export function isGarminConfigured(env = process.env) {
  return !!(env.GARMIN_CLIENT_ID && env.GARMIN_CLIENT_SECRET)
}

export const garminRedirectUri = (env = process.env) => env.GARMIN_REDIRECT_URI || GARMIN_REDIRECT_URI
export const garminAuthorizeUrl = (env = process.env) => env.GARMIN_AUTHORIZE_URL || GARMIN_AUTHORIZE_URL
export const garminTokenUrl = (env = process.env) => env.GARMIN_TOKEN_URL || GARMIN_TOKEN_URL
export const garminApiBase = (env = process.env) => (env.GARMIN_API_BASE || GARMIN_API).replace(/\/+$/, '')

/** User endpoints (/user/id, /user/permissions, DELETE /user/registration) live under the partner gateway. */
export const garminUserApiBase = (env = process.env) => `${garminApiBase(env)}/partner-gateway/rest`

export function createPkcePair(verifier = randomBytes(48).toString('base64url')) {
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge, base = GARMIN_AUTHORIZE_URL }) {
  const qs = new URLSearchParams({
    client_id: String(clientId),
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${base}?${qs}`
}

/** Where the OAuth callback sends the browser: the dashboard when the flow started there, else Settings. */
export const garminReturnPath = (returnTo) => (returnTo === 'home' ? '/' : '/connections')

// ---- Tokens ----

export function tokenNeedsRefresh(expiresAt, now = Date.now(), skewS = GARMIN_TOKEN_REFRESH_SKEW_S) {
  if (!expiresAt) return true
  const t = new Date(expiresAt).getTime()
  return Number.isNaN(t) || t - now <= skewS * 1000
}

/** Garmin token response ({ access_token, refresh_token, expires_in }) -> connections columns. */
export function tokensToColumns(resp, now = Date.now()) {
  if (!resp?.access_token || !resp?.refresh_token) return null
  const expiresIn = Number(resp.expires_in)
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    token_expires_at: new Date(now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86400) * 1000).toISOString(),
  }
}

/** Refresh failures that mean the user must reconnect (revoked / invalid grant). */
export function isRevokedGrant(status, body) {
  return status === 400 || status === 401 || body?.error === 'invalid_grant'
}

// ---- Permissions ----

/** Garmin permission list (['ACTIVITY_EXPORT', ...]) -> what the rider allowed. Unknown shape = assume allowed. */
export function permissionFlags(permissions) {
  if (!Array.isArray(permissions)) return { activities: true, workouts: true }
  const set = new Set(permissions.map((p) => String(p).toUpperCase()))
  return { activities: set.has(GARMIN_PERMISSION_ACTIVITY), workouts: set.has(GARMIN_PERMISSION_WORKOUT) }
}

export const NO_ACTIVITY_PERMISSION_MESSAGE =
  'Garmin activity sharing is switched off, so no rides are received. Reconnect Garmin and allow activity export.'
export const NO_WORKOUT_PERMISSION_MESSAGE =
  'Garmin workout sending is switched off. Reconnect Garmin and allow workout import to send planned workouts.'

// ---- Activities ----

/** 'gym' | 'ride' | 'skip' for an analysed .fit summary: only cycling and strength sessions are imported. */
export function classifyGarminSport(summary) {
  if (summary?.activity_type === 'gym') return 'gym'
  const sport = String(summary?.sport ?? '').toLowerCase()
  if (!sport || sport.includes('cycling') || sport.includes('biking') || sport === 'e_biking') return 'ride'
  return 'skip'
}

/** Local wall-clock "YYYY-MM-DDTHH:mm:ss" from epoch seconds plus Garmin's UTC offset in seconds; null without a start. */
export function localStampFromSeconds(startSeconds, offsetSeconds) {
  const s = Number(startSeconds)
  if (!Number.isFinite(s) || s <= 0) return null
  const off = Number(offsetSeconds)
  return new Date((s + (Number.isFinite(off) ? off : 0)) * 1000).toISOString().slice(0, 19)
}

const GARMIN_RIDE_TYPES = new Set([
  'CYCLING', 'BMX', 'CYCLOCROSS', 'DOWNHILL_BIKING', 'E_BIKE_FITNESS', 'E_BIKE_MOUNTAIN', 'E_ENDURO_MTB', 'ENDURO_MTB',
  'GRAVEL_CYCLING', 'INDOOR_CYCLING', 'MOUNTAIN_BIKING', 'RECUMBENT_CYCLING', 'ROAD_BIKING', 'TRACK_CYCLING', 'VIRTUAL_RIDE',
])

/**
 * Activity API appendix A name (activityType in the push) -> 'ride' | 'gym' | 'skip'; null when absent (decide from
 * the file). Hand cycling, running, swimming and the other sports are not imported.
 */
export function classifyGarminActivityType(activityType) {
  const t = String(activityType ?? '').trim().toUpperCase()
  if (!t) return null
  if (GARMIN_RIDE_TYPES.has(t)) return 'ride'
  if (t === 'STRENGTH_TRAINING') return 'gym'
  return 'skip'
}

// ---- Webhooks ----

/** Constant-time comparison of the token in our endpoint URL with the configured one. */
export function matchesWebhookToken(received, expected) {
  if (typeof received !== 'string' || !received || typeof expected !== 'string' || !expected) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
const str = (v) => (v == null || v === '' ? null : String(v))

/**
 * One Garmin push body (any of the registered data types) -> normalised events:
 *  { kind: 'activity_file', userId, summaryId, callbackUrl, activityType, startSeconds, offsetSeconds }
 *  { kind: 'deregistration', userId }
 *  { kind: 'permissions', userId, permissions }
 * Manual activities and non-FIT files carry no file we can analyse and are dropped.
 */
export function parseGarminPush(body) {
  if (!body || typeof body !== 'object') return []
  const events = []
  for (const f of list(body.activityFiles)) {
    const userId = str(f.userId)
    const callbackUrl = str(f.callbackURL)
    const summaryId = str(f.summaryId) || str(f.activityId)
    if (!userId || !callbackUrl || !summaryId || f.manual === true) continue
    if (f.fileType && String(f.fileType).toUpperCase() !== 'FIT') continue
    events.push({
      kind: 'activity_file',
      userId,
      summaryId,
      callbackUrl,
      activityType: str(f.activityType),
      startSeconds: Number(f.startTimeInSeconds) || null,
      offsetSeconds: Number.isFinite(Number(f.startTimeOffsetInSeconds)) ? Number(f.startTimeOffsetInSeconds) : null,
    })
  }
  for (const d of list(body.deregistrations)) {
    if (str(d.userId)) events.push({ kind: 'deregistration', userId: str(d.userId) })
  }
  for (const p of list(body.userPermissionsChange)) {
    if (str(p.userId)) events.push({ kind: 'permissions', userId: str(p.userId), permissions: Array.isArray(p.permissions) ? p.permissions : [] })
  }
  return events
}

/** Callback URLs are only ever fetched from Garmin's own hosts (the payload is not otherwise authenticated). */
export function isGarminHost(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'garmin.com' || u.hostname.endsWith('.garmin.com'))
  } catch {
    return false
  }
}

/** Webhook auth: the secret comes as path segment (portal strips queries) or legacy ?token=. Logs rejections, never the secret. */
export function authorizeGarminWebhook({ pathToken = null, queryToken = null, expected, warn = console.warn }) {
  if (!expected) {
    warn('Garmin webhook: GARMIN_WEBHOOK_TOKEN is not configured')
    return { ok: false, status: 503 }
  }
  const given = pathToken ?? queryToken
  if (!matchesWebhookToken(given, expected)) {
    warn(`Garmin webhook rejected: ${given ? 'token mismatch' : 'no token'} (via ${pathToken != null ? 'path' : 'query'})`)
    return { ok: false, status: 403 }
  }
  return { ok: true, status: 200 }
}
