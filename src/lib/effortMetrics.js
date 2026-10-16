// src/lib/effortMetrics.js
//
// Result metrics every template effort reports (issue #191):
//  - time-keyed efforts (a duration window): the distance covered (`distance_m`) and average
//    speed, integrated from the 1 Hz speed stream (km/h);
//  - distance-keyed efforts (target distance): the exact elapsed time (`elapsed_time_sec`,
//    also written to `estimated_time_sec`), interpolated inside the boundary samples so it is
//    not quantised to whole seconds.
// Efforts also carry `keyed_by` ('time' | 'distance'). Without a usable speed stream the
// efforts get `no_speed_data: true` instead of a misleading value. Purely additive: stored
// executions without these fields keep rendering.
//
// Plain JS (no Node-only APIs): shared by the engine, baselines and the UI.

const round1 = (v) => Math.round(v * 10) / 10
const round3 = (v) => Math.round(v * 1000) / 1000

/** Legacy fixed patterns whose efforts are judged over a distance. */
const LEGACY_DISTANCE_PATTERNS = new Set(['sustained_tt', 'flying_sprint', 'standing_start'])

/** Summary keys: lower is better (times); everything else is higher-is-better. */
export const TIME_RESULT_KEYS = ['best_time_sec', 'avg_time_sec', 'total_time_sec']
export const DISTANCE_RESULT_KEYS = ['best_distance_m', 'avg_distance_m', 'total_distance_m']
export const EFFORT_RESULT_KEYS = [...TIME_RESULT_KEYS, ...DISTANCE_RESULT_KEYS]

/** True for race-time style keys where a smaller value is the better result. */
export function isLowerBetterKey(key) {
  return typeof key === 'string' && (/_time_sec$/.test(key) || /_lap_sec$/.test(key) || key === 'elapsed_time_sec')
}

const isTimeKey = (key) => isLowerBetterKey(key)
const isDistanceKey = (key) => typeof key === 'string' && /_distance_m$/.test(key)

/** Metres covered by one speed sample (km/h, 1 s), treating bad samples as standing still. */
function stepM(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v / 3.6 : 0
}

/** True when the stream covers [start, end) and shows movement in it. */
export function hasSpeedData(speed, start, end) {
  if (!Array.isArray(speed) || end <= start || speed.length < end) return false
  for (let i = start; i < end; i++) if (stepM(speed[i]) > 0) return true
  return false
}

/** Distance in metres over whole seconds [start, end). */
export function distanceOver(speed, start, end) {
  let sum = 0
  for (let i = start; i < end; i++) sum += stepM(speed[i])
  return sum
}

/**
 * Seconds needed to cover `distanceM` starting at second `start`, interpolating inside the
 * boundary sample. Searches up to `limit` (default: end of the stream); null if not reached.
 */
export function timeToCover(speed, start, distanceM, limit = speed?.length ?? 0) {
  if (!Array.isArray(speed) || !(distanceM > 0)) return null
  let cum = 0
  for (let i = start; i < Math.min(limit, speed.length); i++) {
    const step = stepM(speed[i])
    if (step > 0 && cum + step >= distanceM - 1e-9) return round3(i - start + (distanceM - cum) / step)
    cum += step
  }
  return null
}

/**
 * Fastest time to cover `distanceM` anywhere inside [from, to), with both the start and the
 * end interpolated (the optimum always sits on a sample boundary at one of its ends).
 */
export function fastestTimeToCover(speed, from, to, distanceM) {
  if (!Array.isArray(speed) || !(distanceM > 0)) return null
  const lo = Math.max(0, from)
  const hi = Math.min(speed.length, to)
  if (hi <= lo) return null
  const prefix = [0]
  for (let i = lo; i < hi; i++) prefix.push(prefix[prefix.length - 1] + stepM(speed[i]))
  const total = prefix[prefix.length - 1]
  if (total < distanceM - 1e-9) return null

  // Position (fractional seconds from lo) where cumulative distance first reaches `m`.
  const timeAt = (m) => {
    let i = 0
    while (i < prefix.length - 1 && prefix[i + 1] < m - 1e-9) i++
    const step = prefix[i + 1] - prefix[i]
    return step > 0 ? i + (m - prefix[i]) / step : i
  }

  let best = Infinity
  for (let s = 0; s < prefix.length - 1; s++) {
    if (prefix[s] + distanceM <= total + 1e-9) best = Math.min(best, timeAt(prefix[s] + distanceM) - s)
  }
  for (let e = 1; e < prefix.length; e++) {
    if (prefix[e] - distanceM >= -1e-9) best = Math.min(best, e - timeAt(Math.max(0, prefix[e] - distanceM)))
  }
  return Number.isFinite(best) ? round3(best) : null
}

const isWork = (e) => e.role === undefined || e.role === 'work'

function distanceTarget(effort, manifest, pattern) {
  if (effort.target_distance_m != null) return effort.target_distance_m
  if (!LEGACY_DISTANCE_PATTERNS.has(pattern)) return null
  return manifest.distance_m ?? effort.suggested_distance_m ?? null
}

function enrichEffort(effort, speed, manifest, pattern) {
  const target = distanceTarget(effort, manifest, pattern)
  const start = effort.start_sec
  const end = effort.end_sec
  if (typeof start !== 'number' || typeof end !== 'number') return effort

  if (target != null) {
    const elapsed =
      pattern === 'flying_sprint'
        ? fastestTimeToCover(speed, start - 10, end + 10, target)
        : timeToCover(speed, start, target)
    if (elapsed == null) {
      return { ...effort, keyed_by: 'distance', ...(hasSpeedData(speed, start, end) ? {} : { no_speed_data: true }) }
    }
    const out = {
      ...effort,
      keyed_by: 'distance',
      target_distance_m: effort.target_distance_m ?? target,
      elapsed_time_sec: elapsed,
    }
    if (effort.target_distance_m != null) out.estimated_time_sec = elapsed
    if (out.avg_speed_kmh == null) out.avg_speed_kmh = round1((target / elapsed) * 3.6)
    return out
  }

  if (!hasSpeedData(speed, start, end)) return { ...effort, keyed_by: 'time', no_speed_data: true }
  const distance = distanceOver(speed, start, end)
  const dur = end - start
  return {
    ...effort,
    keyed_by: 'time',
    distance_m: Math.round(distance),
    ...(effort.avg_speed_kmh == null && dur > 0 ? { avg_speed_kmh: round1((distance / dur) * 3.6) } : {}),
  }
}

/**
 * Adds distance/elapsed-time results to every effort of an evaluation result, plus
 * best/avg/total aggregates over the work efforts to the summary.
 * @param {{efforts: object[], summary: object}} result
 * @param {object} timeSeries - { speed, ... }
 * @param {object} manifest
 */
export function applyEffortMetrics(result, timeSeries = {}, manifest = {}) {
  if (!result || !Array.isArray(result.efforts) || !result.efforts.length) return result
  const pattern = manifest.pattern || 'repeated_bursts'
  const speed = timeSeries.speed
  const efforts = result.efforts.map((e) => enrichEffort(e, speed, manifest, pattern))

  const work = efforts.filter(isWork)
  const times = work.map((e) => e.elapsed_time_sec).filter((v) => typeof v === 'number')
  const distances = work.filter((e) => e.keyed_by === 'time').map((e) => e.distance_m).filter((v) => typeof v === 'number')
  const summary = { ...(result.summary || {}) }
  if (times.length) {
    const total = times.reduce((a, b) => a + b, 0)
    summary.best_time_sec = round3(Math.min(...times))
    summary.avg_time_sec = round3(total / times.length)
    summary.total_time_sec = round3(total)
  }
  if (distances.length) {
    const total = distances.reduce((a, b) => a + b, 0)
    summary.best_distance_m = Math.max(...distances)
    summary.avg_distance_m = Math.round(total / distances.length)
    summary.total_distance_m = total
  }
  return { ...result, efforts, summary }
}

/** Race time `m:ss.s` (tenths by default), e.g. 62.34 -> "1:02.3". '—' for missing values. */
export function formatRaceTime(seconds, decimals = 1) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—'
  const factor = 10 ** decimals
  const total = Math.round(seconds * factor) / factor
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`
}

/** Distance `x.xx km` from metres. */
export function formatKm(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return '—'
  return `${(meters / 1000).toFixed(2)} km`
}

/** Display text for a summary/effort metric value, race-time or km for the effort result keys. */
export function formatResultValue(key, value) {
  if (typeof value !== 'number') return value == null ? '—' : String(value)
  if (isLowerBetterKey(key) && /_time_sec$/.test(key)) return formatRaceTime(value, 2)
  if (isDistanceKey(key)) return formatKm(value)
  return String(Math.round(value * 10) / 10)
}

/**
 * Delta of a metric vs a baseline for the UI badges.
 * `good` is true when the change is an improvement (lower for times, higher otherwise).
 * @returns {{diff: number, good: boolean, text: string}|null} null when nothing to show
 */
export function describeDelta(key, current, previous) {
  if (typeof current !== 'number' || typeof previous !== 'number') return null
  const timeLike = isTimeKey(key)
  const precision = timeLike ? 100 : 10
  const diff = Math.round((current - previous) * precision) / precision
  if (diff === 0) return null
  const good = timeLike ? diff < 0 : diff > 0
  const abs = Math.abs(diff)
  const text = timeLike ? `${abs.toFixed(2)}s` : isDistanceKey(key) ? formatKm(abs) : String(abs)
  return { diff, good, text }
}
