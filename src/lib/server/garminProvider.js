// src/lib/server/garminProvider.js
//
// Garmin Connect adapter for the shared import pipeline (importActivity.js), plus OAuth/token helpers (#310).
// Starter access is push-only: Garmin posts "activity file" events to our webhook, which stores them in
// garmin_activity_events. This provider lists those pending events as rides and downloads the .fit file from the
// event's callback URL with the rider's token, then runs the same analyzer as Intervals.icu / Wahoo.
// Env (hosting settings, never committed): GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET (+ GARMIN_WEBHOOK_TOKEN).

import { ImportError } from './importErrors.js'
import {
  classifyGarminSport,
  garminUserApiBase,
  garminTokenUrl,
  isGarminHost,
  isRevokedGrant,
  localStampFromSeconds,
  tokenNeedsRefresh,
  tokensToColumns,
} from '../garmin.js'

export const MAX_EVENT_ATTEMPTS = 5
// An activity file URL is valid for 24 hours and can be downloaded only once (a repeat gets HTTP 410).
export const EVENT_MAX_AGE_MS = 24 * 3600 * 1000

/** The user must reconnect (revoked/invalid grant or rejected token). */
export class GarminAuthError extends ImportError {
  constructor(message = 'Garmin rejected the connection. Reconnect Garmin.') {
    super(message, 401)
    this.name = 'GarminAuthError'
    this.fatal = true
  }
}

function credentials() {
  const clientId = process.env.GARMIN_CLIENT_ID
  const clientSecret = process.env.GARMIN_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new ImportError('Garmin is not configured on this deployment.', 503)
  return { clientId, clientSecret }
}

async function postForm(url, params, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params),
      cache: 'no-store',
    })
  } catch {
    throw new ImportError('Could not reach Garmin. Try again in a moment.', 502)
  }
  const body = await res.json().catch(() => null)
  return { res, body }
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. Returns the raw token response. */
export async function exchangeCode(code, redirectUri, codeVerifier, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    garminTokenUrl(),
    { grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: codeVerifier },
    fetchImpl
  )
  if (!res.ok || !tokensToColumns(body)) throw new ImportError('Garmin did not accept the authorization.', 400)
  return body
}

/** Refresh tokens (Garmin rotates the refresh token). Revoked/invalid grants throw GarminAuthError (fatal). */
export async function refreshTokens(refreshToken, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = credentials()
  const { res, body } = await postForm(
    garminTokenUrl(),
    { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken },
    fetchImpl
  )
  if (res.status === 429) throw new ImportError('Garmin rate limit reached, continuing on the next run.', 429)
  if (!res.ok) {
    if (isRevokedGrant(res.status, body)) throw new GarminAuthError()
    throw new ImportError(`Garmin token refresh failed (${res.status})`, 502)
  }
  const cols = tokensToColumns(body)
  if (!cols) throw new ImportError('Garmin returned an unexpected token response.', 502)
  return cols
}

/**
 * Valid access token for a connection row {user_id, access_token, refresh_token, token_expires_at}. Refreshes only
 * when about to expire and persists the rotated tokens first; if the refresh lost a race with a concurrent run, that
 * run's tokens are used.
 */
export async function getFreshAccessToken(service, conn, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!conn?.refresh_token) throw new GarminAuthError('Garmin is not connected. Reconnect Garmin.')
  if (conn.access_token && !tokenNeedsRefresh(conn.token_expires_at, now)) return conn.access_token
  let cols
  try {
    cols = await refreshTokens(conn.refresh_token, { fetchImpl })
  } catch (err) {
    if (err?.name !== 'GarminAuthError') throw err
    const { data } = await service
      .from('connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', conn.user_id)
      .eq('provider', 'garmin')
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
    .eq('provider', 'garmin')
  if (error) console.warn('Persisting refreshed Garmin tokens failed:', error.message)
  Object.assign(conn, cols)
  return cols.access_token
}

async function apiGet(path, accessToken, fetchImpl) {
  let res
  try {
    res = await fetchImpl(`${garminUserApiBase()}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store' })
  } catch {
    throw new ImportError('Could not reach Garmin. Try again in a moment.', 502)
  }
  if (!res.ok) throw new ImportError(`Garmin request failed (${res.status})`, 502)
  return res.json().catch(() => null)
}

/** Garmin API user id of the token's owner: the id Garmin puts in every push. */
export async function fetchGarminUserId(accessToken, { fetchImpl = fetch } = {}) {
  const body = await apiGet('/user/id', accessToken, fetchImpl)
  if (body?.userId == null || body.userId === '') throw new ImportError('Garmin returned an unexpected user response.', 502)
  return String(body.userId)
}

/** Permissions the rider granted (e.g. ['ACTIVITY_EXPORT', 'WORKOUT_IMPORT']); null when they cannot be read. */
export async function fetchGarminPermissions(accessToken, { fetchImpl = fetch } = {}) {
  try {
    const body = await apiGet('/user/permissions', accessToken, fetchImpl)
    return Array.isArray(body) ? body : Array.isArray(body?.permissions) ? body.permissions : null
  } catch {
    return null
  }
}

/** Best-effort removal of our registration for this user (stops Garmin pushes). Never throws. */
export async function deauthorize(accessToken, { fetchImpl = fetch } = {}) {
  if (!accessToken) return false
  try {
    const res = await fetchImpl(`${garminUserApiBase()}/user/registration`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

const eventToRide = (e) => ({
  id: String(e.summary_id),
  name: null,
  start_time: e.start_time_s ? new Date(Number(e.start_time_s) * 1000).toISOString() : null,
  start_date_local: localStampFromSeconds(e.start_time_s, e.start_offset_s),
})

/**
 * @param {{ service: object, userId: string, accessToken: string, fetchImpl?: typeof fetch, now?: () => number }} opts
 */
export function createGarminProvider({ service, userId, accessToken, fetchImpl = fetch, now = Date.now }) {
  if (!accessToken) throw new GarminAuthError('Garmin is not connected. Reconnect Garmin.')
  const events = new Map() // summary id -> event row seen in a list

  const setStatus = (summaryId, patch) =>
    service.from('garmin_activity_events').update({ ...patch, updated_at: new Date(now()).toISOString() }).eq('user_id', userId).eq('summary_id', String(summaryId))

  return {
    source: 'garmin',

    // Starter has no history: there is nothing older than what Garmin pushed.
    async listWindow() {
      return { rides: [], exhausted: true, nextBefore: null }
    },

    /** Pushed activity files that still wait for their import. */
    async listActivities() {
      const since = new Date(now() - EVENT_MAX_AGE_MS).toISOString()
      const { data, error } = await service
        .from('garmin_activity_events')
        .select('summary_id, callback_url, start_time_s, start_offset_s, attempts')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lt('attempts', MAX_EVENT_ATTEMPTS)
        .gte('received_at', since)
        .order('start_time_s', { ascending: false })
        .limit(50)
      if (error) throw new ImportError(`Reading Garmin events failed: ${error.message}`, 500)
      for (const e of data || []) events.set(String(e.summary_id), e)
      return (data || []).map(eventToRide)
    },

    async fetchActivity(externalId, { analyzeFit, gearing = {} } = {}) {
      const id = String(externalId)
      let ev = events.get(id)
      if (!ev) {
        const { data } = await service
          .from('garmin_activity_events')
          .select('summary_id, callback_url, start_time_s, start_offset_s, attempts')
          .eq('user_id', userId)
          .eq('summary_id', id)
          .maybeSingle()
        ev = data
      }
      if (!ev) throw new ImportError(`Garmin activity ${id} was not received from Garmin.`, 404)
      if (!analyzeFit) throw new ImportError('Garmin import needs the .fit analyzer.', 500)
      if (!isGarminHost(ev.callback_url)) {
        console.info(`Garmin import: activity ${id} skipped, unexpected download address`)
        await setStatus(id, { status: 'error', last_error: 'Unexpected download address.' })
        return { skip: true }
      }
      await setStatus(id, { attempts: (Number(ev.attempts) || 0) + 1 })
      console.info(`Garmin import: downloading file for activity ${id} (attempt ${(Number(ev.attempts) || 0) + 1})`)

      let blob
      try {
        const res = await fetchImpl(ev.callback_url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
        console.info(`Garmin import: file download for activity ${id} answered ${res.status}`)
        if (res.status === 401) throw new GarminAuthError()
        if (res.status === 410) {
          await setStatus(id, { status: 'error', last_error: 'Garmin file was already downloaded or has expired.' })
          return { skip: true }
        }
        if (res.status === 412) {
          await setStatus(id, { status: 'error', last_error: 'Activity sharing is not allowed at Garmin.' })
          return { skip: true }
        }
        if (!res.ok) throw new ImportError(`Garmin file download failed (${res.status})`, 502)
        blob = await res.blob()
      } catch (err) {
        if (err instanceof ImportError) throw err
        throw new ImportError('Could not download the Garmin activity file. Try again in a moment.', 502)
      }
      // The URL is single-use, so a file that fails from here on cannot be fetched again: settle it as an error.
      const fail = async (message) => {
        await setStatus(id, { status: 'error', last_error: message })
        throw new ImportError(message, 422)
      }
      if (!blob.size) await fail(`Garmin activity ${id} has an empty file.`)
      const parsed = await analyzeFit(blob, `${id}.fit`, gearing).catch(() => null)
      if (!parsed?.success) await fail(`The Garmin file of activity ${id} could not be analysed.`)

      const kind = classifyGarminSport(parsed.summary)
      console.info(`Garmin import: activity ${id} analysed as ${kind} (sport=${parsed.summary?.sport ?? 'unknown'}, ${blob.size} bytes)${kind === 'skip' ? ': skipped, not a ride or gym session' : ''}`)
      // Settled either way: a file that is neither cycling nor strength is never imported, and one that was
      // analysed is not downloaded again (the import itself skips duplicates).
      await setStatus(id, { status: kind === 'skip' ? 'skipped' : 'imported', last_error: null })
      if (kind === 'skip') return { skip: true }

      const ride = eventToRide(ev)
      return {
        ...(kind === 'gym' ? { activityType: 'gym', strength: parsed.strength } : {}),
        title: null,
        startDateLocal: ride.start_date_local,
        summary: { ...parsed.summary, start_time: parsed.summary?.start_time || ride.start_time },
        curves: parsed.curves || {},
        time_series: parsed.time_series || {},
      }
    },
  }
}

/** Provider for a connections row; refreshes the token first. */
export async function createGarminProviderForConnection(service, conn, opts = {}) {
  const accessToken = await getFreshAccessToken(service, conn, opts)
  return createGarminProvider({ service, userId: conn.user_id, accessToken, fetchImpl: opts.fetchImpl })
}
