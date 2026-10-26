// src/lib/gymAnalysis.js
//
// Gym sessions (issue #326) have no cycling power: power/cadence/speed curves, normalized power, TSS and
// route data are meaningless. Every ingestion path (manual upload, bulk import, Intervals.icu, Strava,
// Wahoo) passes its analysis through `prepareAnalysis`, so rides are returned untouched and gym sessions
// keep only what applies: duration, heart rate (summary, curve, series) and calories.

import { normalizeActivityType } from './activityType.js'

const GYM_SUMMARY_KEYS = ['start_time', 'elapsed_time_s', 'moving_time_s', 'avg_hr', 'max_hr', 'calories']

/**
 * @param {{ summary?: object, curves?: object, time_series?: object }} analysis - api/analyze.py shape
 * @param {string|null} [activityType] - explicit type (provider/user); falls back to summary.activity_type
 * @returns {{ activityType: string, summary: object, curves: object, time_series: object }}
 */
export function prepareAnalysis(analysis, activityType = null) {
  const summary = analysis?.summary || {}
  const type = normalizeActivityType(activityType || summary.activity_type)
  if (type !== 'gym') {
    return { activityType: 'ride', summary, curves: analysis?.curves || {}, time_series: analysis?.time_series || {} }
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
