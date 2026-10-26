// src/lib/server/stravaRepair.js
//
// Repairs already-imported Strava rides (Intervals.icu rides are never touched):
//  - curve gap: no activity_curves rows although the ride stores its curves snapshot (curves_data).
//    Rebuilt locally, no Strava request needed.
//  - heartrate gap: time_series has no heartrate key (rides imported before heartrate was emitted).
//    Streams are re-fetched and re-analysed; time_series, curves_data and activity_curves are replaced.
//    Summary fields (title, user edits) are left alone. Costs one Strava read per ride, taken from the
//    shared backfill budget by the provider.

import { insertCurves } from './importActivity.js'

export const STRAVA_REPAIR_PER_RUN = 3
const CURVE_SCAN_LIMIT = 200

async function replaceCurves(service, activityId, curves) {
  const { error: delErr } = await service.from('activity_curves').delete().eq('activity_id', activityId)
  if (delErr) throw new Error(`Clearing curves failed: ${delErr.message}`)
  const err = await insertCurves(service, activityId, curves)
  if (err) throw new Error(`Saving curves failed: ${err.message}`)
}

/** Strava rides with a stored curves snapshot but no activity_curves rows. */
export async function findCurveGaps(service, userId, limit = CURVE_SCAN_LIMIT) {
  const { data: rides, error } = await service
    .from('activities')
    .select('id, curves_data')
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('activity_type', 'ride')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !rides?.length) return []
  const { data: rows } = await service.from('activity_curves').select('activity_id').in('activity_id', rides.map((r) => r.id))
  const have = new Set((rows || []).map((r) => r.activity_id))
  return rides.filter((r) => !have.has(r.id) && r.curves_data && Object.keys(r.curves_data).length > 0)
}

/** Strava rides whose time_series lacks the heartrate key, newest first. */
export async function findHeartrateGaps(service, userId, limit = STRAVA_REPAIR_PER_RUN) {
  const { data, error } = await service
    .from('activities')
    .select('id, external_id, chainring, cog')
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('activity_type', 'ride')
    .is('time_series->heartrate', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return error ? [] : data || []
}

async function markNoStreams(service, activity) {
  // Strava has no streams for this ride: record an empty heartrate series so it is not retried forever.
  const { data } = await service.from('activities').select('time_series').eq('id', activity.id).maybeSingle()
  const ts = data?.time_series && typeof data.time_series === 'object' ? data.time_series : {}
  await service.from('activities').update({ time_series: { ...ts, heartrate: [] } }).eq('id', activity.id)
}

/**
 * @returns {Promise<{ curvesRebuilt: number, reanalyzed: number, failed: number, stop: 'budget'|'rate'|null, error: string|null }>}
 */
export async function repairStravaActivities(service, { userId, provider, maxFetches = STRAVA_REPAIR_PER_RUN }) {
  const out = { curvesRebuilt: 0, reanalyzed: 0, failed: 0, stop: null, error: null }

  for (const ride of await findCurveGaps(service, userId)) {
    try {
      await replaceCurves(service, ride.id, ride.curves_data)
      out.curvesRebuilt++
    } catch (err) {
      out.failed++
      out.error = err.message
    }
  }

  provider.setPurpose?.('backfill')
  for (const ride of await findHeartrateGaps(service, userId, maxFetches)) {
    try {
      const analyzed = await provider.analyzeStreamsFor(ride.external_id, {
        chainring: ride.chainring,
        cog: ride.cog,
        isFixedGear: false,
      })
      const { error } = await service
        .from('activities')
        .update({ time_series: analyzed.time_series, curves_data: analyzed.curves })
        .eq('id', ride.id)
      if (error) throw new Error(error.message)
      await replaceCurves(service, ride.id, analyzed.curves)
      out.reanalyzed++
    } catch (err) {
      if (err?.budget || err?.status === 429) {
        out.stop = err.budget ? 'budget' : 'rate'
        break
      }
      if (err?.status === 404) {
        await markNoStreams(service, ride)
        continue
      }
      if (err?.fatal) {
        out.error = err.message
        break
      }
      out.failed++
      out.error = err.message
    }
  }
  return out
}
