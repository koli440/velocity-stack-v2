// src/lib/server/wahooProvider.js
//
// Wahoo Cloud adapter for the shared import pipeline (importActivity.js), plus OAuth/token helpers.
// Wahoo rides come with a .fit file (downloaded from Wahoo's CDN, which is not an API request) that goes through
// the same analyzer as Intervals.icu. The workout list already embeds each workout_summary (incl. the file URL), so
// importing a ride costs no extra API request.
// Env (hosting settings, never committed): WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET (+ WAHOO_WEBHOOK_TOKEN for webhooks).

import { ImportError } from './importErrors.js'
import {
  WAHOO_API,
  filterWahooRides,
  isImportableWorkout,
  isRateLimitNear,
  isRevokedGrant,
  mapWahooWorkout,
  parseRateLimit,
  tokenNeedsRefresh,
  tokensToColumns,
} from '../wahoo.js'

const PAGE_SIZE = 100
const MAX_PAGES = 10

/** Rate limited (HTTP 429 or a window nearly exhausted): stop the run and retry later, not fatal. */
export class WahooRateLimitError extends ImportError {
  constructor(message = 'Wahoo rate limit reached, continuing on the next run.') {
    super(message, 429)
    this.name = 'WahooRateLimitError'
  }
}

/** The user must reconnect (revoked/invalid grant or rejected token). */
export class WahooAuthError extends ImportError {
  constructor(message = 'Wahoo rejected the connection. Reconnect Wahoo.') {
    super(message, 401)
    this.name = 'WahooAuthError'
    this.fatal = true
  }
}

function credentials() {
  const clientId = process.env.WAHOO_CLIENT_ID
  const clientSecret = process.env.WAHOO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new ImportError('Wahoo is not configured on this deployment.', 503)
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
    throw new ImportError('Could not reach Wahoo. Try again in a moment.', 502)
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    // non-JSON error page
  }
  return { res, body }
}

/** Exchange an authorization code for tokens (confidential app, no PKCE). Returns the raw token response. */
export async function exchangeCode(code, redirectUri, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    `${WAHOO_API}/oauth/token`,
    { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' },
    fetchImpl
  )
  if (!res.ok || !tokensToColumns(body)) throw new ImportError('Wahoo did not accept the authorization.', 400)
  return body
}

/** Refresh tokens. Revoked/invalid grants throw WahooAuthError (fatal). */
export async function refreshTokens(refreshToken, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    `${WAHOO_API}/oauth/token`,
    { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    fetchImpl
  )
  if (res.status === 429) throw new WahooRateLimitError()
  if (!res.ok) {
    if (isRevokedGrant(res.status, body)) throw new WahooAuthError()
    throw new ImportError(`Wahoo token refresh failed (${res.status})`, 502)
  }
  const cols = tokensToColumns(body)
  if (!cols) throw new ImportError('Wahoo returned an unexpected token response.', 502)
  return cols
}

/**
 * Valid access token for a connection row {user_id, access_token, refresh_token, token_expires_at}. Refreshes only
 * when the token is about to expire (Wahoo caps unrevoked tokens per user, and the old token is only revoked by the
 * first API call made with the new one), persisting the new tokens first. If the refresh fails because a concurrent
 * run already rotated the refresh token, that run's tokens are used.
 */
export async function getFreshAccessToken(service, conn, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!conn?.refresh_token) throw new WahooAuthError('Wahoo is not connected. Reconnect Wahoo.')
  if (conn.access_token && !tokenNeedsRefresh(conn.token_expires_at, now)) return conn.access_token
  let cols
  try {
    cols = await refreshTokens(conn.refresh_token, { fetchImpl })
  } catch (err) {
    if (err?.name !== 'WahooAuthError') throw err
    const { data } = await service
      .from('connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', conn.user_id)
      .eq('provider', 'wahoo')
      .maybeSingle()
    if (data?.access_token && data.refresh_token !== conn.refresh_token && !tokenNeedsRefresh(data.token_expires_at, now)) {
      Object.assign(conn, data)
      return data.access_token
    }
    throw err
  }
  const { error } = await service
    .from('connections')
    .update({ ...cols, updated_at: new Date().toISOString() })
    .eq('user_id', conn.user_id)
    .eq('provider', 'wahoo')
  if (error) console.warn('Persisting refreshed Wahoo tokens failed:', error.message)
  Object.assign(conn, cols)
  return cols.access_token
}

/** Wahoo user id of the token's owner (needs the user_read scope). */
export async function fetchWahooUserId(accessToken, { fetchImpl = fetch } = {}) {
  let res
  try {
    res = await fetchImpl(`${WAHOO_API}/v1/user`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  } catch {
    throw new ImportError('Could not reach Wahoo. Try again in a moment.', 502)
  }
  if (!res.ok) throw new ImportError(`Wahoo user lookup failed (${res.status})`, 502)
  const user = await res.json().catch(() => null)
  if (user?.id == null) throw new ImportError('Wahoo returned an unexpected user response.', 502)
  return String(user.id)
}

/** Best-effort revocation of our access for this user (Wahoo then also removes our scheduled workouts/plans). Never throws. */
export async function deauthorize(accessToken, { fetchImpl = fetch } = {}) {
  if (!accessToken) return false
  try {
    const res = await fetchImpl(`${WAHOO_API}/v1/permissions`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

const startMs = (w) => Date.parse(w?.starts)

/**
 * @param {{ accessToken: string, fetchImpl?: typeof fetch }} opts
 */
export function createWahooProvider({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new WahooAuthError('Wahoo is not connected. Reconnect Wahoo.')
  let lastRateLimit = null
  const listed = new Map() // ride id -> mapped ride (carries the file URL)
  const pages = new Map() // page number -> { workouts, total }
  const remember = (rides) => rides.forEach((r) => listed.set(String(r.id), r))

  const get = async (path) => {
    if (isRateLimitNear(lastRateLimit)) throw new WahooRateLimitError()
    let res
    try {
      res = await fetchImpl(`${WAHOO_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
    } catch {
      throw new ImportError('Could not reach Wahoo. Try again in a moment.', 502)
    }
    lastRateLimit = parseRateLimit(res.headers) || lastRateLimit
    if (res.status === 429) throw new WahooRateLimitError()
    if (res.status === 401) throw new WahooAuthError()
    return res
  }

  // One page of workouts, newest first (Wahoo always sorts by start, descending).
  const fetchPage = async (page) => {
    if (pages.has(page)) return pages.get(page)
    const res = await get(`/v1/workouts?${new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) })}`)
    if (!res.ok) throw new ImportError(`Wahoo API error (${res.status})`, res.status)
    const body = await res.json()
    const entry = {
      workouts: Array.isArray(body?.workouts) ? body.workouts : [],
      total: Number.isFinite(Number(body?.total)) ? Number(body.total) : 0,
      // Wahoo may cap per_page, so paging maths uses what it actually applied.
      perPage: Number(body?.per_page) > 0 ? Number(body.per_page) : PAGE_SIZE,
    }
    pages.set(page, entry)
    return entry
  }

  // First page whose oldest workout starts at or before `beforeMs` (pages are sorted, so binary search).
  const findStartPage = async (beforeMs, pageCount) => {
    let lo = 1
    let hi = pageCount
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      const { workouts } = await fetchPage(mid)
      const last = workouts.length ? startMs(workouts[workouts.length - 1]) : -Infinity
      if (last <= beforeMs) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  return {
    source: 'wahoo',

    /**
     * One newest-first page of rides in [oldest, before]; `exhausted` when no older rides remain in the window and
     * `nextBefore` (ISO) is where the next page continues. Wahoo can only page from the newest workout, so the page
     * holding `before` is located by bisection (a handful of requests) instead of walking every newer page.
     * @param {{ oldest?: string, before?: string }} opts
     */
    async listWindow({ oldest, before } = {}) {
      const oldestMs = oldest ? Date.parse(`${oldest}T00:00:00Z`) : -Infinity
      const beforeMs = before ? Date.parse(before) : Infinity
      const first = await fetchPage(1)
      const pageCount = Math.max(1, Math.ceil(first.total / first.perPage))
      const page = Number.isFinite(beforeMs) ? await findStartPage(beforeMs, pageCount) : 1
      const { workouts } = await fetchPage(page)

      let minStart = Infinity
      for (const w of workouts) minStart = Math.min(minStart, startMs(w) || Infinity)
      const inWindow = workouts.filter((w) => startMs(w) <= beforeMs && startMs(w) >= oldestMs)
      const rides = filterWahooRides(inWindow)
      remember(rides)
      const exhausted = page >= pageCount || workouts.length === 0 || minStart < oldestMs
      const nextBefore = Number.isFinite(minStart) ? new Date(minStart).toISOString() : null
      return { rides, exhausted, nextBefore }
    },

    /** Rides since `oldest` (YYYY-MM-DD), newest first; omit for full history. */
    async listActivities({ oldest } = {}) {
      const oldestMs = oldest ? Date.parse(`${oldest}T00:00:00Z`) : -Infinity
      const rides = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { workouts, total, perPage } = await fetchPage(page)
        rides.push(...filterWahooRides(workouts.filter((w) => startMs(w) >= oldestMs)))
        const minStart = workouts.length ? Math.min(...workouts.map((w) => startMs(w) || Infinity)) : -Infinity
        if (workouts.length === 0 || page * perPage >= total || minStart < oldestMs) break
      }
      remember(rides)
      return rides
    },

    async fetchActivity(externalId, { gearing = {}, analyzeFit } = {}) {
      const id = String(externalId)
      let ride = listed.get(id)
      if (!ride) {
        // Not seen in a list (single-ride import, e.g. from a webhook): one read for the workout incl. its summary.
        const res = await get(`/v1/workouts/${encodeURIComponent(id)}`)
        if (res.status === 404) throw new ImportError(`Wahoo workout ${id} was not found.`, 404)
        if (!res.ok) throw new ImportError(`Wahoo API error (${res.status})`, res.status)
        const workout = await res.json()
        if (!isImportableWorkout(workout)) throw new ImportError(`Wahoo workout ${id} is not a recorded ride with a file.`, 422)
        ride = mapWahooWorkout(workout)
      }

      if (!analyzeFit) throw new ImportError('Wahoo import needs the .fit analyzer.', 500)
      let blob
      try {
        const fileRes = await fetchImpl(ride.file_url, { cache: 'no-store' })
        if (!fileRes.ok) throw new ImportError(`Wahoo file download failed (${fileRes.status})`, 502)
        blob = await fileRes.blob()
      } catch (err) {
        if (err instanceof ImportError) throw err
        throw new ImportError('Could not download the Wahoo ride file. Try again in a moment.', 502)
      }
      if (!blob.size) throw new ImportError(`Wahoo ride ${id} has an empty file.`, 422)
      const parsed = await analyzeFit(blob, `${id}.fit`, gearing)
      if (!parsed?.success) throw new ImportError(`The Wahoo file of ride ${id} could not be analysed.`, 422)

      // The list's start/duration drive de-duplication when the analyzer reports none.
      const summary = {
        ...parsed.summary,
        start_time: parsed.summary?.start_time || ride.start_time,
        elapsed_time_s: parsed.summary?.elapsed_time_s ?? ride.elapsed_time_s,
      }
      return {
        title: ride.name,
        startDateLocal: ride.start_date_local,
        summary,
        curves: parsed.curves,
        time_series: parsed.time_series || {},
      }
    },
  }
}

/** Provider for a connections row; refreshes the token first. */
export async function createWahooProviderForConnection(service, conn, opts = {}) {
  const accessToken = await getFreshAccessToken(service, conn, opts)
  return createWahooProvider({ accessToken, fetchImpl: opts.fetchImpl })
}
