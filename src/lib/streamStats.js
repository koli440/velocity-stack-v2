// Stats for the visible (zoomed) range of the Activity Graph. Works on the points built by
// buildStreamSeries (1 Hz samples, one per second, so every sample has the same time weight,
// which makes plain means time-weighted). Pauses are not stored as samples, so they never skew averages.
// NP reuses normalizedPower from summaryMetrics (same algorithm as the activity summary and templates).

import { normalizedPower } from './summaryMetrics.js'

/**
 * Sample index range [first, last] (inclusive) for an x-range in the current axis unit
 * (seconds or metres). Time and distance mode map the same ride segment to the same samples.
 * A null range means the whole activity. Returns null when no sample lies in the range.
 */
export function sampleRange(points, range = null) {
  if (!points?.length) return null
  if (!range) return [0, points.length - 1]
  const [lo, hi] = range
  let first = -1
  let last = -1
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x
    if (first === -1 && x >= lo) first = i
    if (x <= hi) last = i
  }
  if (first === -1 || last < first) return null
  return [first, last]
}

const nonNull = (points, key) => points.map((p) => p[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v))
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

/**
 * @param {Array<object>} points - buildStreamSeries output
 * @param {[number, number]|null} range - zoom range in the current axis unit, null = whole activity
 * @param {{ ftp?: number|null }} [opts]
 * @returns {object|null} stats; metrics the stream lacks are null. np is null for selections under 30 s.
 */
export function computeStreamStats(points, range = null, { ftp = null } = {}) {
  const r = sampleRange(points, range)
  if (!r) return null
  const slice = points.slice(r[0], r[1] + 1)

  const speed = nonNull(slice, 'speed')
  const watts = nonNull(slice, 'watts')
  const hr = nonNull(slice, 'heartrate')
  const cadence = nonNull(slice, 'cadence')
  const torque = nonNull(slice, 'torque')

  const avgPower = mean(watts)
  const np = watts.length ? normalizedPower(slice.map((p) => p.watts)) : null
  const ftpW = Number(ftp) > 0 ? Number(ftp) : null

  return {
    durationS: slice.length,
    distanceM: speed.length ? speed.reduce((a, b) => a + b, 0) / 3.6 : null,
    avgSpeed: mean(speed),
    avgHr: mean(hr),
    maxHr: hr.length ? Math.max(...hr) : null,
    avgPower,
    maxPower: watts.length ? Math.max(...watts) : null,
    np,
    hasPower: watts.length > 0,
    vi: np && avgPower ? np / avgPower : null,
    intensityFactor: np && ftpW ? np / ftpW : null,
    avgCadence: mean(cadence),
    avgTorque: mean(torque),
  }
}
