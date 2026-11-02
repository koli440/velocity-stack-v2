// src/lib/gymAnalysis.js
//
// Gym sessions (issue #326) have no cycling power: power/cadence/speed curves, normalized power, TSS and
// route data are meaningless. Every ingestion path (manual upload, bulk import, Intervals.icu, Strava,
// Wahoo, Garmin) passes its analysis through `prepareAnalysis`, so rides are returned untouched and gym sessions
// keep only what applies: duration, heart rate (summary, curve, series) and calories.

import { normalizeActivityType } from './activityType.js'
import { buildGymDetail } from './gymDetail.js'
import { sportFromFit, sportInfo } from './sportType.js'

const GYM_SUMMARY_KEYS = ['start_time', 'elapsed_time_s', 'moving_time_s', 'avg_hr', 'max_hr', 'calories']

/**
 * @param {{ summary?: object, curves?: object, time_series?: object }} analysis - api/analyze.py shape
 * @param {string|null} [sportHint] - canonical sport key from the provider (src/lib/sportType.js); beats the FIT sport
 * @param {string|null} [activityType] - explicit type (provider/user); falls back to summary.activity_type
 * @returns {{ activityType: string, summary: object, curves: object, time_series: object, gym: object|null }}
 *   `gym` is the exercises/sets detail (FIT strength files only), null for rides and summary-only sessions
 */
export function prepareAnalysis(analysis, activityType = null, sportHint = null) {
  const summary = analysis?.summary || {}
  const type = normalizeActivityType(activityType || sportInfo(sportHint)?.activityType || summary.activity_type)
  if (type !== 'gym') {
    // Rides and runs keep the full analysis; the canonical sport (MTB, gravel, trail run...) comes from the FIT sport.
    const sport = sportInfo(sportHint) && sportInfo(sportHint).activityType !== 'gym' ? sportHint : sportFromFit(summary)
    const info = sportInfo(sport)
    const isRun = type === 'run' || info?.activityType === 'run'
    return {
      activityType: isRun ? 'run' : 'ride',
      sport: isRun ? (info?.activityType === 'run' ? sport : 'run') : sport,
      rideType: isRun ? (info?.activityType === 'run' ? info.rideType : 'run') : info?.rideType ?? null,
      summary,
      curves: analysis?.curves || {},
      time_series: analysis?.time_series || {},
      gym: null,
    }
  }
  const gymSummary = { activity_type: 'gym' }
  for (const k of GYM_SUMMARY_KEYS) if (summary[k] != null) gymSummary[k] = summary[k]
  const curves = analysis?.curves?.HeartRate && Object.keys(analysis.curves.HeartRate).length
    ? { HeartRate: analysis.curves.HeartRate }
    : {}
  const hr = analysis?.time_series?.heartrate
  return {
    activityType: 'gym',
    summary: gymSummary,
    curves,
    time_series: Array.isArray(hr) && hr.length ? { heartrate: hr } : {},
    gym: buildGymDetail(analysis?.strength),
  }
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Summary-only gym analysis for sources without a file or streams (e.g. a manually entered Strava workout).
 * @param {{ startTime?: string|null, elapsedS?: number|null, movingS?: number|null, avgHr?: number|null, maxHr?: number|null, calories?: number|null }} m
 */
export function gymSummaryFromMeta({ startTime = null, elapsedS = null, movingS = null, avgHr = null, maxHr = null, calories = null } = {}) {
  const summary = { activity_type: 'gym', start_time: startTime || null, elapsed_time_s: num(elapsedS), moving_time_s: num(movingS) }
  const a = num(avgHr)
  const m = num(maxHr)
  const c = num(calories)
  if (a != null) summary.avg_hr = Math.round(a)
  if (m != null) summary.max_hr = Math.round(m)
  if (c != null) summary.calories = Math.round(c)
  return { summary, curves: {}, time_series: {} }
}
