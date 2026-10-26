// src/lib/wahoo.js
// Pure Wahoo Cloud helpers (#311): OAuth URLs/tokens, workout mapping, webhook parsing, rate-limit parsing.
// No network or DB access here. OAuth state signing is shared with Strava (src/lib/strava.js).

import { timingSafeEqual } from 'node:crypto'

export const WAHOO_API = 'https://api.wahooligan.com'
export const WAHOO_SCOPES = ['user_read', 'workouts_read', 'workouts_write', 'plans_write', 'offline_data']
// Registered with Wahoo, so it is fixed (not derived from the request host).
export const WAHOO_REDIRECT_URI = 'https://www.velocity-stack.app/api/connections/wahoo/callback'
// Wahoo access tokens last 2 h. Refresh only right before a call: every refresh that is not followed by an API
// call leaves another unrevoked token (cap: 10 per user).
export const WAHOO_TOKEN_REFRESH_SKEW_S = 60
// Wahoo workout_type_id values of the BIKING family (indoor and outdoor), excluding motorcycling.
export const WAHOO_CYCLING_TYPE_IDS = [0, 11, 12, 13, 14, 15, 16, 49, 61, 64, 68, 70]

export function isWahooConfigured(env = process.env) {
  return !!(env.WAHOO_CLIENT_ID && env.WAHOO_CLIENT_SECRET)
}

export function wahooRedirectUri(env = process.env) {
  return env.WAHOO_REDIRECT_URI || WAHOO_REDIRECT_URI
}

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const qs = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: WAHOO_SCOPES.join(' '),
    state,
  })
  return `${WAHOO_API}/oauth/authorize?${qs}`
}

/** Where the OAuth callback sends the browser: the dashboard when the flow started there, else Settings. */
export function wahooReturnPath(returnTo) {
  return returnTo === 'home' ? '/' : '/settings'
}

// ---- Tokens ----

export function tokenNeedsRefresh(expiresAt, now = Date.now(), skewS = WAHOO_TOKEN_REFRESH_SKEW_S) {
  if (!expiresAt) return true
  const t = new Date(expiresAt).getTime()
  if (Number.isNaN(t)) return true
  return t - now <= skewS * 1000
}

/** Wahoo token response ({ access_token, refresh_token, expires_in, created_at }) -> connections columns. */
export function tokensToColumns(resp, now = Date.now()) {
  if (!resp?.access_token || !resp?.refresh_token) return null
  const expiresIn = Number(resp.expires_in)
  const createdMs = Number(resp.created_at) > 0 ? Number(resp.created_at) * 1000 : now
  const expiresMs = createdMs + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200) * 1000
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    token_expires_at: new Date(expiresMs).toISOString(),
  }
}

/** Refresh failures that mean the user must reconnect (revoked / invalid grant). */
export function isRevokedGrant(status, body) {
  if (status === 400 || status === 401) return true
  return body?.error === 'invalid_grant'
}

// ---- Workouts ----

export function isWahooCyclingWorkout(w) {
  return WAHOO_CYCLING_TYPE_IDS.includes(Number(w?.workout_type_id))
}

/** Strength / gym-class workouts (issue #326): WORKOUT (42) and CARDIO_CLASS (43). */
export const WAHOO_GYM_TYPE_IDS = [42, 43]

export function isWahooGymWorkout(w) {
  return WAHOO_GYM_TYPE_IDS.includes(Number(w?.workout_type_id))
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Local wall-clock "YYYY-MM-DDTHH:mm:ss" of a UTC instant in an IANA time zone; null when unknown/invalid. */
export function localStamp(startsIso, timeZone) {
  const t = new Date(startsIso)
  if (Number.isNaN(t.getTime()) || !timeZone) return null
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(t)
        .map((p) => [p.type, p.value])
    )
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  } catch {
    return null
  }
}

/**
 * Whether a workout holds a finished ride we can import: a cycling type, recorded by a Wahoo device/app
 * (not manually entered) and with a .fit file. Wahoo does not share third-party workouts at all.
 */
export function isImportableWorkout(w) {
  const s = w?.workout_summary
  if (isWahooGymWorkout(w)) return s?.manual !== true
  return isWahooCyclingWorkout(w) && !!s?.file?.url && s.manual !== true
}

/** Wahoo workout (with embedded workout_summary) -> the shared "ride" shape used by selectNewRides. */
export function mapWahooWorkout(w) {
  const s = w.workout_summary || {}
  const total = num(s.duration_total_accum)
  return {
    id: String(w.id),
    name: s.name || w.name || null,
    start_time: w.starts ? new Date(w.starts).toISOString() : null,
    start_date_local: localStamp(w.starts, s.time_zone),
    elapsed_time_s: total != null ? Math.round(total) : null,
    moving_time_s: num(s.duration_active_accum),
    distance_m: num(s.distance_accum),
    average_watts: num(s.power_avg),
    file_url: s.file?.url || null,
    ...(isWahooGymWorkout(w)
      ? {
          activity_type: 'gym',
          average_heartrate: num(s.heart_rate_avg),
          calories: num(s.calories_accum),
        }
      : {}),
  }
}

export function filterWahooRides(workouts) {
  return (Array.isArray(workouts) ? workouts : []).filter(isImportableWorkout).map(mapWahooWorkout)
}

// ---- Webhooks ----

/** Constant-time comparison of the webhook_token Wahoo sends with the configured one. */
export function matchesWebhookToken(received, expected) {
  if (typeof received !== 'string' || !received || typeof expected !== 'string' || !expected) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * @returns {{ kind: 'workout_summary', userId: string, workoutId: string|null, summaryId: string|null } | { kind: 'ignore' }}
 */
export function parseWebhookEvent(body) {
  if (!body || typeof body !== 'object') return { kind: 'ignore' }
  if (body.event_type !== 'workout_summary' || body.user?.id == null) return { kind: 'ignore' }
  const summary = body.workout_summary || {}
  return {
    kind: 'workout_summary',
    userId: String(body.user.id),
    workoutId: summary.workout?.id != null ? String(summary.workout.id) : null,
    summaryId: summary.id != null ? String(summary.id) : null,
  }
}

// ---- Rate limits ----

/** "4999, 999, 199" -> [4999, 999, 199] (day, hour, 5 min); null when missing/invalid. */
function triple(v) {
  if (!v) return null
  const p = String(v).split(',').map((x) => Number(x.trim()))
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? p : null
}

export function parseRateLimit(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k])
  const limit = triple(get('x-ratelimit-limit'))
  const remaining = triple(get('x-ratelimit-remaining'))
  return limit && remaining ? { limit, remaining } : null
}

/** True when another call would likely hit the daily, hourly or 5-minute limit (small safety margin). */
export function isRateLimitNear(rl, margin = 3) {
  if (!rl) return false
  return rl.remaining.some((r) => r <= margin)
}
