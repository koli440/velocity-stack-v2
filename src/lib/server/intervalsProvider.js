// src/lib/server/intervalsProvider.js
//
// Intervals.icu adapter for the shared import pipeline (importActivity.js).
//
// Provider adapter contract (a Strava adapter plugs in the same way):
//   {
//     source: 'intervals',                     // activities.source / external_source value
//     fetchActivity(externalId, { gearing, analyzeFit }) ->
//       Promise<{ title, startDateLocal, summary, curves, time_series }>
//   }
// `summary`/`curves`/`time_series` have the api/analyze.py shape. Throws ImportError on failure.

import { analyzeStreams } from '../streamAnalysis.js'
import { ImportError } from './importErrors.js'
import { isGymSportType } from '../activityType.js'
import { gymSummaryFromMeta } from '../gymAnalysis.js'
import { newestFirst, rideTimeMs } from '../syncPlan.js'

const BASE_URL = 'https://intervals.icu/api/v1'
const STREAM_TYPES = 'watts,cadence,heartrate,velocity_smooth,latlng,altitude,distance'

/** OAuth tokens use Bearer; legacy API keys use Basic. */
export function intervalsAuthHeader(apiKey, accessToken) {
  if (accessToken) return `Bearer ${accessToken}`
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`
}

/** Athlete id for API paths: "0" resolves to the token's athlete when using OAuth. */
export function intervalsPathAthlete(athleteId, accessToken) {
  return accessToken ? '0' : athleteId
}

/** Exchange an authorization code (valid for 2 minutes) for an access token. */
export async function exchangeIntervalsCode({ code, codeVerifier, redirectUri, env = process.env, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: String(env.INTERVALS_CLIENT_ID),
    client_secret: String(env.INTERVALS_CLIENT_SECRET),
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  })
  const res = await fetchImpl('https://intervals.icu/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  if (!res.ok) throw new ImportError(`Intervals.icu token exchange failed (${res.status})`, 502)
  return res.json()
}

/** Revoke an OAuth access token (best effort; the connection is dropped locally either way). */
export async function revokeIntervalsToken(accessToken, fetchImpl = fetch) {
  if (!accessToken) return false
  try {
    const res = await fetchImpl(`${BASE_URL}/disconnect-app`, {
      method: 'DELETE',
      headers: { Authorization: intervalsAuthHeader(null, accessToken) },
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

export function filterRides(activities) {
  return (Array.isArray(activities) ? activities : [])
    .filter((a) => a.type === 'Ride' || a.type === 'VirtualRide')
    .map((a) => ({
      id: a.id,
      name: a.name,
      start_date_local: a.start_date_local,
      distance_m: a.distance,
      moving_time_s: a.moving_time,
      average_watts: a.average_watts,
      max_watts: a.max_watts,
      average_cadence: a.average_cadence,
    }))
}

/** Rides (shape unchanged) plus gym sessions tagged `activity_type: 'gym'` (issue #326). */
export function filterActivities(activities) {
  const list = Array.isArray(activities) ? activities : []
  const gymIds = new Set(list.filter((a) => isGymSportType(a?.type)).map((a) => a.id))
  return list
    .filter((a) => a.type === 'Ride' || a.type === 'VirtualRide' || gymIds.has(a.id))
    .map((a) => {
      const base = filterRides([a])[0] || {
        id: a.id,
        name: a.name,
        start_date_local: a.start_date_local,
        distance_m: a.distance,
        moving_time_s: a.moving_time,
      }
      return gymIds.has(a.id) ? { ...base, activity_type: 'gym' } : base
    })
}

/** Verify credentials against the Intervals.icu API. Throws ImportError (401/403 => bad credentials). */
export async function validateIntervalsCredentials({ athleteId, apiKey, fetchImpl = fetch }) {
  if (!athleteId || !apiKey) throw new ImportError('Athlete ID and API key are required', 400)
  let res
  try {
    res = await fetchImpl(`${BASE_URL}/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: intervalsAuthHeader(apiKey) },
      cache: 'no-store',
    })
  } catch {
    throw new ImportError('Could not reach Intervals.icu. Try again in a moment.', 502)
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new ImportError('Intervals.icu rejected these credentials. Check the Athlete ID and API key.', 400)
  }
  if (!res.ok) throw new ImportError(`Intervals.icu API error (${res.status})`, 502)
}

/**
 * @param {{ athleteId: string, apiKey?: string, accessToken?: string, fetchImpl?: typeof fetch }} opts
 */
export function createIntervalsProvider({ athleteId, apiKey, accessToken, fetchImpl = fetch }) {
  if (!athleteId || !(apiKey || accessToken)) {
    throw new ImportError('Missing Intervals.icu credentials', 400)
  }
  const headers = { Authorization: intervalsAuthHeader(apiKey, accessToken) }
  athleteId = intervalsPathAthlete(athleteId, accessToken)
  const get = (url) => fetchImpl(url, { headers, cache: 'no-store' })

  return {
    source: 'intervals',

    /** @param {string} oldest - YYYY-MM-DD (inclusive); omit for the full history */
    async listActivities({ oldest } = {}) {
      const qs = oldest ? `?oldest=${oldest}` : `?oldest=1970-01-01`
      const res = await get(`${BASE_URL}/athlete/${athleteId}/activities${qs}`)
      if (!res.ok) {
        const errText = await res.text()
        throw new ImportError(`Intervals.icu API error (${res.status}): ${errText}`, res.status)
      }
      return filterActivities(await res.json())
    },

    /**
     * Rides in [oldest, before] newest-first. Intervals.icu has no paging, so the whole window comes in one
     * (cheap, summary-only) request and is trimmed/sorted here; `exhausted` is always true.
     * @param {{ oldest?: string, before?: string }} opts - oldest YYYY-MM-DD, before an ISO timestamp
     */
    async listWindow({ oldest, before } = {}) {
      const beforeMs = before ? new Date(before).getTime() : null
      const params = new URLSearchParams({ oldest: oldest || '1970-01-01' })
      if (beforeMs != null && !Number.isNaN(beforeMs)) params.set('newest', new Date(beforeMs).toISOString().split('T')[0])
      const res = await get(`${BASE_URL}/athlete/${athleteId}/activities?${params}`)
      if (!res.ok) {
        const errText = await res.text()
        throw new ImportError(`Intervals.icu API error (${res.status}): ${errText}`, res.status)
      }
      const rides = newestFirst(filterActivities(await res.json())).filter(
        (r) => beforeMs == null || Number.isNaN(beforeMs) || rideTimeMs(r) <= beforeMs
      )
      return { rides, exhausted: true, nextBefore: null }
    },

    async fetchActivity(externalId, { gearing = {}, analyzeFit } = {}) {
      const actId = String(externalId)

      let title = null
      let startDateLocal = null
      let meta = null
      try {
        const metaRes = await get(`${BASE_URL}/activity/${actId}`)
        if (metaRes.ok) {
          meta = await metaRes.json()
          title = meta?.name || null
          startDateLocal = meta?.start_date_local || null
        }
      } catch {
        // metadata is cosmetic; fall back to defaults
      }
      const activityType = isGymSportType(meta?.type) ? 'gym' : 'ride'
      const typeField = activityType === 'gym' ? { activityType } : {}
      // Summary-only fallback for gym sessions without a file or streams (manual entries).
      const gymFallback = () => {
        const m = gymSummaryFromMeta({
          startTime: meta?.start_date ? new Date(meta.start_date).toISOString() : null,
          elapsedS: meta?.elapsed_time,
          movingS: meta?.moving_time,
          avgHr: meta?.average_heartrate,
          maxHr: meta?.max_heartrate,
          calories: meta?.calories,
        })
        return { title, startDateLocal, activityType, ...m }
      }

      // Preferred: raw .fit through the shared analyzer so metrics match a manual upload (issue #11).
      // Any failure (network, non-JSON platform error page) falls back to streams below.
      if (analyzeFit) {
        try {
          const fileRes = await get(`${BASE_URL}/activity/${actId}/file`)
          if (fileRes.ok) {
            const fitBlob = await fileRes.blob()
            if (fitBlob.size > 0) {
              const parsed = await analyzeFit(fitBlob, `${actId}.fit`, gearing)
              if (parsed?.success) {
                return {
                  title,
                  startDateLocal,
                  ...typeField,
                  summary: parsed.summary,
                  curves: parsed.curves,
                  time_series: parsed.time_series || {},
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Preferred .fit analysis failed for activity ${actId}, using streams:`, err.message)
        }
      }

      const streamsRes = await get(`${BASE_URL}/activity/${actId}/streams?types=${STREAM_TYPES}`)
      const streamsData = streamsRes.ok ? await streamsRes.json() : null
      const analyzed = analyzeStreams(streamsData, gearing)
      if (!analyzed) {
        if (activityType === 'gym') return gymFallback()
        throw new ImportError(`No data is available in Intervals.icu for ride ${actId}.`, 404)
      }
      return { title, startDateLocal, ...typeField, ...analyzed }
    },
  }
}
