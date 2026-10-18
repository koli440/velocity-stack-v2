// src/lib/server/stravaProvider.js
//
// Strava adapter for the shared import pipeline (importActivity.js), plus the OAuth/token and
// webhook-subscription helpers. Strava has no .fit download, so rides are analysed from streams.
// Env (hosting settings, never committed): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.

import { analyzeStreams } from '../streamAnalysis.js'
import { ImportError } from './importErrors.js'
import {
  STRAVA_STREAM_KEYS,
  isStravaRide,
  afterEpoch,
  filterStravaRides,
  isRateLimitNear,
  isRevokedGrant,
  parseRateLimit,
  stravaStreamsToList,
  tokenNeedsRefresh,
  tokensToColumns,
} from '../strava.js'

const API = 'https://www.strava.com/api/v3'
const OAUTH = 'https://www.strava.com/oauth'
const PAGE_SIZE = 100
const MAX_PAGES = 10

/** Rate limited (HTTP 429 or limit nearly exhausted): stop the run and retry later, not fatal. */
export class StravaRateLimitError extends ImportError {
  constructor(message = 'Strava rate limit reached, continuing on the next run.') {
    super(message, 429)
    this.name = 'StravaRateLimitError'
  }
}

/** The shared Strava budget (or this purpose's share of it) is spent: stop cleanly, resume after the window resets. */
export class StravaBudgetError extends StravaRateLimitError {
  constructor(message = 'Strava request budget spent, continuing after the rate-limit window resets.') {
    super(message)
    this.name = 'StravaBudgetError'
    this.budget = true
  }
}

/** The user must reconnect (revoked/invalid grant or rejected token). */
export class StravaAuthError extends ImportError {
  constructor(message = 'Strava rejected the connection. Reconnect Strava.') {
    super(message, 401)
    this.name = 'StravaAuthError'
    this.fatal = true
  }
}

function credentials() {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new ImportError('Strava is not configured on this deployment.', 503)
  return { clientId, clientSecret }
}

async function postForm(url, params, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      cache: 'no-store',
    })
  } catch {
    throw new ImportError('Could not reach Strava. Try again in a moment.', 502)
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    // non-JSON error page
  }
  return { res, body }
}

/** Exchange an authorization code for tokens. Returns the Strava token response (incl. athlete). */
export async function exchangeCode(code, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    `${OAUTH}/token`,
    { client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' },
    fetchImpl
  )
  if (!res.ok || !tokensToColumns(body)) throw new ImportError('Strava did not accept the authorization.', 400)
  return body
}

/** Refresh tokens. Revoked/invalid grants throw StravaAuthError (fatal). */
export async function refreshTokens(refreshToken, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    `${OAUTH}/token`,
    { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    fetchImpl
  )
  if (res.status === 429) throw new StravaRateLimitError()
  if (!res.ok) {
    if (isRevokedGrant(res.status, body)) throw new StravaAuthError()
    throw new ImportError(`Strava token refresh failed (${res.status})`, 502)
  }
  const cols = tokensToColumns(body)
  if (!cols) throw new ImportError('Strava returned an unexpected token response.', 502)
  return cols
}

/**
 * Valid access token for a connection row {user_id, access_token, refresh_token, token_expires_at},
 * refreshing (and persisting the new tokens) when it is about to expire.
 */
export async function getFreshAccessToken(service, conn, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!conn?.refresh_token) throw new StravaAuthError('Strava is not connected. Reconnect Strava.')
  if (conn.access_token && !tokenNeedsRefresh(conn.token_expires_at, now)) return conn.access_token
  const cols = await refreshTokens(conn.refresh_token, { fetchImpl })
  const { error } = await service
    .from('connections')
    .update({ ...cols, updated_at: new Date().toISOString() })
    .eq('user_id', conn.user_id)
    .eq('provider', 'strava')
  if (error) console.warn('Persisting refreshed Strava tokens failed:', error.message)
  conn.access_token = cols.access_token
  conn.refresh_token = cols.refresh_token
  conn.token_expires_at = cols.token_expires_at
  return cols.access_token
}

/** Best-effort deauthorization at Strava (revokes our access for this athlete). Never throws. */
export async function deauthorize(accessToken, { fetchImpl = fetch } = {}) {
  if (!accessToken) return false
  try {
    const res = await fetchImpl(`${OAUTH}/deauthorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * @param {{ accessToken: string, fetchImpl?: typeof fetch, budget?: { reserve(purpose: string): boolean, observe(headers: any): void } }} opts
 *   `budget` is the shared app-wide tracker (server/stravaBudget.js); every request is reserved against it.
 */
export function createStravaProvider({ accessToken, fetchImpl = fetch, budget = null }) {
  if (!accessToken) throw new StravaAuthError('Strava is not connected. Reconnect Strava.')
  let lastRateLimit = null
  let purpose = 'live'
  // List items are kept so a ride import needs only the streams request (the list already carries
  // name, start dates, distance and moving/elapsed time; the detail endpoint adds nothing the import uses).
  const listed = new Map()
  const remember = (rides) => rides.forEach((r) => listed.set(String(r.id), r))

  const get = async (path) => {
    if (isRateLimitNear(lastRateLimit)) throw new StravaRateLimitError()
    if (budget && !budget.reserve(purpose)) throw new StravaBudgetError()
    let res
    try {
      res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
    } catch {
      throw new ImportError('Could not reach Strava. Try again in a moment.', 502)
    }
    lastRateLimit = parseRateLimit(res.headers) || lastRateLimit
    budget?.observe(res.headers)
    if (res.status === 429) throw new StravaRateLimitError()
    if (res.status === 401) throw new StravaAuthError()
    return res
  }

  return {
    source: 'strava',

    /** 'live' (webhook / new rides, whole budget) or 'backfill' (limited share of the budget). */
    setPurpose(p) {
      purpose = p === 'backfill' ? 'backfill' : 'live'
    },

    /**
     * One newest-first page of rides in [oldest, before]; `exhausted` when no older rides remain in the window
     * and `nextBefore` (ISO) is where the next page continues (also past non-ride activities).
     * @param {{ oldest?: string, before?: string, maxPages?: number }} opts
     */
    async listWindow({ oldest, before, maxPages = 1 } = {}) {
      const after = afterEpoch(oldest)
      const beforeEpoch = before ? Math.floor(new Date(before).getTime() / 1000) + 1 : undefined
      const rides = []
      let exhausted = false
      let nextBefore = null
      for (let page = 1; page <= maxPages; page++) {
        const qs = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) })
        if (after) qs.set('after', String(after))
        if (Number.isFinite(beforeEpoch)) qs.set('before', String(beforeEpoch))
        const res = await get(`/athlete/activities?${qs}`)
        if (!res.ok) throw new ImportError(`Strava API error (${res.status})`, res.status)
        const items = await res.json()
        const arr = Array.isArray(items) ? items : []
        rides.push(...filterStravaRides(arr))
        const oldestRaw = arr.length ? arr[arr.length - 1]?.start_date : null
        if (oldestRaw) nextBefore = oldestRaw
        if (arr.length < PAGE_SIZE) {
          exhausted = true
          break
        }
      }
      remember(rides)
      return { rides, exhausted, nextBefore }
    },

    /** @param {{ oldest?: string }} opts - YYYY-MM-DD lower bound; omit for full history */
    async listActivities({ oldest } = {}) {
      const after = afterEpoch(oldest)
      const rides = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const qs = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) })
        if (after) qs.set('after', String(after))
        const res = await get(`/athlete/activities?${qs}`)
        if (!res.ok) throw new ImportError(`Strava API error (${res.status})`, res.status)
        const items = await res.json()
        rides.push(...filterStravaRides(items))
        if (!Array.isArray(items) || items.length < PAGE_SIZE) break
      }
      remember(rides)
      return rides
    },

    /** Streams request + analysis (same output shape as the .fit path); throws 404 ImportError without data. */
    async analyzeStreamsFor(externalId, gearing = {}) {
      const id = String(externalId)
      const streamsRes = await get(`/activities/${encodeURIComponent(id)}/streams?keys=${STRAVA_STREAM_KEYS}&key_by_type=true`)
      const streams = streamsRes.ok ? await streamsRes.json() : null
      const analyzed = analyzeStreams(stravaStreamsToList(streams), gearing)
      if (!analyzed) throw new ImportError(`No stream data is available in Strava for ride ${id}.`, 404)
      return analyzed
    },

    async fetchActivity(externalId, { gearing = {} } = {}) {
      const id = String(externalId)
      let detail
      const item = listed.get(id)
      if (item) {
        detail = {
          name: item.name,
          start_date: item.start_time,
          start_date_local: item.start_date_local,
          elapsed_time: item.elapsed_time_s ?? undefined,
          moving_time: item.moving_time_s,
        }
      } else {
        // Not seen in a list (single-ride import): one extra read for the same fields.
        const detailRes = await get(`/activities/${encodeURIComponent(id)}`)
        if (detailRes.status === 404) throw new ImportError(`Strava activity ${id} was not found.`, 404)
        if (!detailRes.ok) throw new ImportError(`Strava API error (${detailRes.status})`, detailRes.status)
        detail = await detailRes.json()
        if (!isStravaRide(detail)) throw new ImportError(`Strava activity ${id} is not a ride.`, 422)
      }

      const analyzed = await this.analyzeStreamsFor(id, gearing)

      // Streams carry no clock; the activity's start/duration drive de-duplication against other sources.
      const summary = {
        ...analyzed.summary,
        start_time: detail.start_date || null,
        elapsed_time_s: detail.elapsed_time ?? analyzed.summary.elapsed_time_s,
      }
      if (detail.moving_time && analyzed.summary.moving_time_s == null) summary.moving_time_s = detail.moving_time
      return {
        title: detail.name || null,
        startDateLocal: detail.start_date_local ? String(detail.start_date_local).replace(/Z$/, '') : null,
        summary,
        curves: analyzed.curves,
        time_series: analyzed.time_series,
      }
    },
  }
}

/** Provider for a connections row; refreshes the token first. */
export async function createStravaProviderForConnection(service, conn, opts = {}) {
  const accessToken = await getFreshAccessToken(service, conn, opts)
  return createStravaProvider({ accessToken, fetchImpl: opts.fetchImpl, budget: opts.budget })
}

// ---- Webhook subscription (one per Strava app) ----

/** Create the push subscription unless one already exists. Returns { status: 'exists'|'created', id }. */
export async function ensureWebhookSubscription({ callbackUrl, verifyToken, fetchImpl = fetch }) {
  const { clientId, clientSecret } = credentials()
  const listRes = await fetchImpl(
    `${API}/push_subscriptions?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret })}`,
    { cache: 'no-store' }
  )
  if (!listRes.ok) throw new ImportError(`Strava subscription lookup failed (${listRes.status})`, 502)
  const existing = await listRes.json()
  if (Array.isArray(existing) && existing.length) return { status: 'exists', id: existing[0].id }

  const { res, body } = await postForm(
    `${API}/push_subscriptions`,
    { client_id: clientId, client_secret: clientSecret, callback_url: callbackUrl, verify_token: verifyToken },
    fetchImpl
  )
  if (!res.ok) {
    throw new ImportError(`Strava rejected the webhook subscription (${res.status}): ${JSON.stringify(body)}`, 502)
  }
  return { status: 'created', id: body?.id ?? null }
}
