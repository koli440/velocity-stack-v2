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

const BASE_URL = 'https://intervals.icu/api/v1'
const STREAM_TYPES = 'watts,cadence,heartrate,velocity_smooth,latlng,altitude,distance'

export function intervalsAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`
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
 * @param {{ athleteId: string, apiKey: string, fetchImpl?: typeof fetch }} opts
 */
export function createIntervalsProvider({ athleteId, apiKey, fetchImpl = fetch }) {
  if (!athleteId || !apiKey) {
    throw new ImportError('Missing Intervals Athlete ID or API Key', 400)
  }
  const headers = { Authorization: intervalsAuthHeader(apiKey) }
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
      return filterRides(await res.json())
    },

    async fetchActivity(externalId, { gearing = {}, analyzeFit } = {}) {
      const actId = String(externalId)

      let title = null
      let startDateLocal = null
      try {
        const metaRes = await get(`${BASE_URL}/activity/${actId}`)
        if (metaRes.ok) {
          const meta = await metaRes.json()
          title = meta?.name || null
          startDateLocal = meta?.start_date_local || null
        }
      } catch {
        // metadata is cosmetic; fall back to defaults
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
        throw new ImportError(`No data is available in Intervals.icu for ride ${actId}.`, 404)
      }
      return { title, startDateLocal, ...analyzed }
    },
  }
}
