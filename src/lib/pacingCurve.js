// src/lib/pacingCurve.js
//
// Typical pacing SHAPE of a rider for one discipline + distance, derived from their PB Vault
// records (issue #434). The curve is a relative lap-time profile (deviation from the effort's own
// average lap), not absolute lap values, so it can be re-applied to any target time.
//
// Lap-time metric only: PB Vault stores per-segment times (`lap_times`), but no power or speed
// series, so there is nothing to build the secondary variants from.

/** Minimum usable splits in a record. */
export const MIN_SEGMENTS = 2
/** Records whose splits don't add up to the recorded time within this ratio are treated as partial. */
export const SPLIT_SUM_TOLERANCE = 0.05

export const FALLBACK_REASONS = {
  NO_RECORDS: 'no-records',
  NO_LAPS: 'no-lap-data',
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Returns the record's splits when usable for a lap-time profile, otherwise null.
 * @param {{ lap_times?: Array<number|string>, time_seconds?: number|string }} record
 * @returns {number[]|null}
 */
export function usableLapTimes(record) {
  const raw = record?.lap_times
  if (!Array.isArray(raw)) return null
  const laps = raw.map(Number)
  if (laps.length < MIN_SEGMENTS || laps.some((t) => !Number.isFinite(t) || t <= 0)) return null
  const total = Number(record.time_seconds)
  if (Number.isFinite(total) && total > 0) {
    const sum = laps.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - total) / total > SPLIT_SUM_TOLERANCE) return null
  }
  return laps
}

/**
 * Relative deviation of each split from the effort's average split (0 = average, +0.02 = 2% slower).
 * @param {number[]} lapTimes
 * @returns {number[]}
 */
export function relativeProfile(lapTimes) {
  const avg = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length
  return lapTimes.map((t) => t / avg - 1)
}

/**
 * Resamples a profile to `n` points by linear interpolation over the normalised distance, so
 * records split on tracks with a different lap length can still contribute.
 * @param {number[]} profile
 * @param {number} n
 * @returns {number[]}
 */
export function resampleProfile(profile, n) {
  if (profile.length === n) return [...profile]
  const m = profile.length
  return Array.from({ length: n }, (_, i) => {
    const pos = ((i + 0.5) / n) * m - 0.5
    const lo = Math.min(m - 1, Math.max(0, Math.floor(pos)))
    const hi = Math.min(m - 1, lo + 1)
    const frac = Math.min(1, Math.max(0, pos - lo))
    return profile[lo] * (1 - frac) + profile[hi] * frac
  })
}

/**
 * Light 3-point smoothing of interior laps; the first and last lap keep their own value because
 * the start and the finishing effort are real features of a pacing profile.
 * @param {number[]} profile
 * @returns {number[]}
 */
export function smoothProfile(profile) {
  if (profile.length < 3) return [...profile]
  return profile.map((v, i) =>
    i === 0 || i === profile.length - 1 ? v : 0.25 * profile[i - 1] + 0.5 * v + 0.25 * profile[i + 1]
  )
}

/**
 * Derives the typical pacing shape for `laps` laps from PB Vault records of ONE discipline and
 * ONE distance (the caller filters by distance; there is no scaling across distances).
 * All records count equally. Records without usable splits are skipped.
 *
 * @param {Array<object>} records - personal_bests rows (lap_times, time_seconds)
 * @param {number} laps - number of laps in the plan
 * @returns {{ ok: true, shape: number[], recordsUsed: number, recordsTotal: number }
 *   | { ok: false, reason: string, recordsUsed: 0, recordsTotal: number }}
 */
export function buildPacingCurve(records, laps) {
  const list = Array.isArray(records) ? records : []
  const n = Math.round(laps)
  if (list.length === 0) {
    return { ok: false, reason: FALLBACK_REASONS.NO_RECORDS, recordsUsed: 0, recordsTotal: 0 }
  }
  const profiles = []
  for (const record of list) {
    const lapTimes = usableLapTimes(record)
    if (lapTimes) profiles.push(resampleProfile(relativeProfile(lapTimes), n))
  }
  if (profiles.length === 0 || !(n > 1)) {
    return { ok: false, reason: FALLBACK_REASONS.NO_LAPS, recordsUsed: 0, recordsTotal: list.length }
  }
  const median_ = Array.from({ length: n }, (_, i) => median(profiles.map((p) => p[i])))
  const smoothed = smoothProfile(median_)
  const mean = smoothed.reduce((a, b) => a + b, 0) / n
  return {
    ok: true,
    shape: smoothed.map((v) => v - mean),
    recordsUsed: profiles.length,
    recordsTotal: list.length,
  }
}

/**
 * Applies a pacing shape to a target time: lap i = avg * (1 + shape[i]), rescaled so the laps sum
 * exactly to `targetSeconds`.
 * @param {number[]} shape
 * @param {number} targetSeconds
 * @returns {number[]}
 */
export function applyPacingShape(shape, targetSeconds) {
  const avg = targetSeconds / shape.length
  const raw = shape.map((s) => avg * (1 + s))
  const sum = raw.reduce((a, b) => a + b, 0)
  return raw.map((t) => (t * targetSeconds) / sum)
}

/**
 * Human-readable reason for falling back to the generic model.
 * @param {string} reason
 * @param {{ disciplineName?: string, distanceM?: number }} ctx
 * @returns {string}
 */
export function fallbackMessage(reason, { disciplineName = 'this discipline', distanceM = 0 } = {}) {
  if (reason === FALLBACK_REASONS.NO_LAPS) {
    return `Your PB Vault records for ${disciplineName} over ${distanceM} m have no usable lap splits, so the generic model is used.`
  }
  return `No PB Vault records for ${disciplineName} over ${distanceM} m yet, so the generic model is used. Curves are never scaled across distances.`
}
