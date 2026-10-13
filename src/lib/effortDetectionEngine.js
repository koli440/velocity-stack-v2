/**
 * Universal effort detection engine for VelocityStack
 */

// Helper function: moving average to smooth out noise
function movingAverage(arr, windowSize = 3) {
  if (!arr || arr.length === 0) return []
  return arr.map((val, idx) => {
    const start = Math.max(0, idx - windowSize + 1)
    const subset = arr.slice(start, idx + 1)
    return subset.reduce((a, b) => a + b, 0) / subset.length
  })
}

/**
 * Main detection dispatcher
 */
export function analyzeSessionEfforts({
  discipline = 'f200',
  timeSeries = {},
  userRole = 'masters', // e.g. masters (3km), elite (4km)
  // Only used by the user-authorable `custom_intervals` pattern (issue #14):
  steps = null,
  repeatCount = null,
  ftpAtActivityW = null,
}) {
  const { watts = [], cadence = [], torque = [], speed = [] } = timeSeries

  if (!watts.length && !cadence.length) {
    return { pattern: 'none', efforts: [], message: 'Missing per-second data for analysis.' }
  }

  // 0. Profile: user-authored interval DSL (issue #14, distance-keyed steps added in #43)
  if (discipline === 'custom_intervals') {
    return detectCustomIntervalSequence({ watts, speed, steps: steps || [], repeatCount: repeatCount || 1, ftpAtActivityW })
  }

  // 1. Profile: Sustained effort (Pursuit)
  if (discipline === 'individual_pursuit' || discipline === 'team_pursuit') {
    return detectSustainedTimeTrial(watts, cadence, userRole)
  }

  // 2. Profile: Flying 200 (F200)
  if (discipline === 'f200' || discipline === 'match_sprint') {
    return detectFlyingSprint(cadence, watts)
  }

  // 3. Profile: Standing start (1km, 500m, Standing Start)
  if (discipline === 'standing_start' || discipline === 'team_sprint') {
    return detectStandingStart(torque, cadence, watts)
  }

  // 4. Profile: Points Race / Scratch / Intervals (repeated bursts)
  return detectRepeatedBursts(watts, cadence)
}

// A. Pursuit and time-trial detector
function detectSustainedTimeTrial(watts, cadence, userRole) {
  const active = watts.filter((w) => w > 120)
  if (active.length < 50) return { pattern: 'sustained_tt', efforts: [] }

  const sorted = [...active].sort((a, b) => b - a)
  const threshold = sorted[Math.floor(sorted.length * 0.25)] * 0.75 // 75% of race pace

  let inEffort = false
  let start = 0
  let drops = 0
  const candidates = []

  for (let i = 0; i < watts.length; i++) {
    const w = watts[i] || 0
    if (!inEffort) {
      if (w >= threshold) {
        inEffort = true
        start = i
        drops = 0
      }
    } else {
      if (w < threshold) {
        drops++
        if (drops > 4 || i === watts.length - 1) {
          const end = i - drops
          const dur = end - start
          if (dur >= 60 && dur <= 360) {
            candidates.push({ start, end, dur })
          }
          inEffort = false
        }
      } else {
        drops = 0
      }
    }
  }

  // Select the main pursuit block
  const best = candidates.sort((a, b) => b.dur - a.dur)[0]
  if (!best) return { pattern: 'sustained_tt', efforts: [] }

  const segWatts = watts.slice(best.start, best.end)
  const segCad = cadence.slice(best.start, best.end)
  const avgW = Math.round(segWatts.reduce((a, b) => a + b, 0) / best.dur)

  // Automatic distance suggestion
  let dist = 3000
  let label = '3 km Pursuit (Masters)'
  if (best.dur < 100) {
    dist = 1000
    label = '1 km Standing Start'
  } else if (best.dur < 185) {
    dist = 2000
    label = '2 km Pursuit'
  } else if (best.dur >= 185 && best.dur <= 255) {
    dist = 3000
    label = '3 km Pursuit (Masters)'
  } else {
    dist = 4000
    label = '4 km Pursuit (Elite)'
  }

  const speedKmh = Math.round(((dist / best.dur) * 3.6) * 10) / 10
  const lapTime250m = (best.dur / (dist / 250)).toFixed(2)

  return {
    pattern: 'sustained_tt',
    efforts: [
      {
        id: `tt_${best.start}`,
        start_sec: best.start,
        end_sec: best.end,
        duration_sec: best.dur,
        suggested_distance_m: dist,
        discipline_label: label,
        avg_power: avgW,
        max_power: Math.max(...segWatts),
        avg_cadence: segCad.length ? Math.round(segCad.reduce((a, b) => a + b, 0) / best.dur) : null,
        calculated_speed_kmh: speedKmh,
        lap_time_250m: lapTime250m,
      },
    ],
  }
}

// B. Flying 200 (F200) detector
function detectFlyingSprint(cadence, watts) {
  if (!cadence.length) return { pattern: 'flying_sprint', efforts: [] }

  // Look for the absolute cadence peak after the run-up
  let maxRpmIdx = 0
  let maxRpm = 0

  cadence.forEach((rpm, idx) => {
    if (rpm > maxRpm) {
      maxRpm = rpm
      maxRpmIdx = idx
    }
  })

  if (maxRpm < 120) return { pattern: 'flying_sprint', efforts: [] }

  // F200 lasts about 10-13 seconds around the peak
  const start = Math.max(0, maxRpmIdx - 6)
  const end = Math.min(cadence.length - 1, maxRpmIdx + 6)
  const dur = end - start

  const segCad = cadence.slice(start, end)
  const segW = watts.slice(start, end)

  return {
    pattern: 'flying_sprint',
    efforts: [
      {
        id: `f200_${start}`,
        start_sec: start,
        end_sec: end,
        duration_sec: dur,
        suggested_distance_m: 200,
        discipline_label: '200m flying start',
        max_cadence: maxRpm,
        avg_cadence: Math.round(segCad.reduce((a, b) => a + b, 0) / dur),
        max_power: segW.length ? Math.max(...segW) : null,
        estimated_f200_time: (dur * (200 / (dur * 17.5))).toFixed(3), // estimated time
      },
    ],
  }
}

// C. Standing start detector
function detectStandingStart(torque, cadence, watts) {
  // Look for the first massive torque spike (> 75 Nm) from low cadence
  let startIdx = -1
  for (let i = 0; i < torque.length; i++) {
    if ((torque[i] || 0) > 75 && (cadence[i] || 0) < 60) {
      startIdx = i
      break
    }
  }

  if (startIdx === -1) return { pattern: 'standing_start', efforts: [] }

  // We track the effort for 60-80 s
  const endIdx = Math.min(torque.length - 1, startIdx + 70)
  const dur = endIdx - startIdx

  return {
    pattern: 'standing_start',
    efforts: [
      {
        id: `standing_${startIdx}`,
        start_sec: startIdx,
        end_sec: endIdx,
        duration_sec: dur,
        suggested_distance_m: 1000,
        discipline_label: 'Standing Start (Kilo / 500m)',
        peak_torque: Math.max(...torque.slice(startIdx, endIdx)),
        max_power: watts.length ? Math.max(...watts.slice(startIdx, endIdx)) : null,
      },
    ],
  }
}

// D. Repeated attacks detector (Points Race, Scratch, Intervals)
function detectRepeatedBursts(watts, cadence) {
  const activeW = watts.filter((w) => w > 150)
  const p90 = activeW.length ? [...activeW].sort((a, b) => b - a)[Math.floor(activeW.length * 0.15)] : 350

  const efforts = []
  let inBurst = false
  let start = 0

  for (let i = 0; i < watts.length; i++) {
    const w = watts[i] || 0
    if (!inBurst && w >= p90) {
      inBurst = true
      start = i
    } else if (inBurst && (w < p90 * 0.8 || i === watts.length - 1)) {
      const dur = i - start
      if (dur >= 8) {
        efforts.push({
          id: `burst_${start}`,
          start_sec: start,
          end_sec: i,
          duration_sec: dur,
          max_power: Math.max(...watts.slice(start, i)),
          avg_power: Math.round(watts.slice(start, i).reduce((a, b) => a + b, 0) / dur),
          type: 'Sharp attack / Breakaway / Sprint for the line',
        })
      }
      inBurst = false
    }
  }

  return {
    pattern: 'repeated_bursts',
    efforts: efforts.slice(0, 10), // top 10 attacks
  }
}

// E. User-authorable custom interval sequence detector (issue #14, extended
// with distance-keyed steps in issue #43)
//
// Unlike the discipline-specific detectors above, this one is driven entirely
// by the manifest parsed from a user's DSL template (src/lib/intervalDsl.js):
// a cyclic `work`(+`recovery`) state machine with no assumption about when
// the sequence starts, matched "at least N" (partial matches are valid, not
// failures) rather than requiring the full configured repeat count.
//
// Each step is either duration-keyed (search windows by elapsed time) or
// distance-keyed (search windows by cumulative distance, derived from the
// per-second `speed` stream in km/h: metersAt(s, e) = sum(speed[s..e)) / 3.6).
// Both kinds support a threshold band (%FTP / W / km/h) or a `best` band,
// which for distance-keyed steps must specify the metric to optimise
// (`bestMetric`: 'power' or 'speed').

function buildPrefixSum(arr, n) {
  const len = n != null ? n : arr.length
  const prefix = new Array(len + 1).fill(0)
  for (let i = 0; i < len; i++) {
    prefix[i + 1] = prefix[i] + (arr[i] || 0)
  }
  return prefix
}

function windowSum(prefix, start, end) {
  return prefix[end] - prefix[start]
}

function windowAvg(prefix, start, end) {
  return windowSum(prefix, start, end) / (end - start)
}

function durationRange(step) {
  const tol = step.durationTolerancePct / 100
  const durMin = Math.max(1, Math.round(step.targetDurationSec * (1 - tol)))
  const durMax = Math.max(durMin, Math.round(step.targetDurationSec * (1 + tol)))
  return { durMin, durMax }
}

function distanceRange(step) {
  const tol = step.durationTolerancePct / 100
  const distMin = Math.max(0, step.targetDistanceM * (1 - tol))
  const distMax = step.targetDistanceM * (1 + tol)
  return { distMin, distMax }
}

/** Cumulative meters covered from second `start` up to (not including) second `end`. */
function metersAt(speedPrefix, start, end) {
  return windowSum(speedPrefix, start, end) / 3.6
}

function computeMetrics(wattsPrefix, speedPrefix, start, end) {
  return {
    avgPower: wattsPrefix ? windowAvg(wattsPrefix, start, end) : null,
    avgSpeedKmh: speedPrefix ? windowAvg(speedPrefix, start, end) : null,
  }
}

function stepBandMatches({ avgPower, avgSpeedKmh }, step, ftpAtActivityW) {
  if (step.bandType === 'pct_ftp') {
    if (!ftpAtActivityW || avgPower == null) return false
    const pct = (avgPower / ftpAtActivityW) * 100
    if (step.powerMin != null && pct < step.powerMin) return false
    if (step.powerMax != null && pct > step.powerMax) return false
    return true
  }
  if (step.bandType === 'watts') {
    if (avgPower == null) return false
    if (step.powerMin != null && avgPower < step.powerMin) return false
    if (step.powerMax != null && avgPower > step.powerMax) return false
    return true
  }
  if (step.bandType === 'speed_kmh') {
    if (avgSpeedKmh == null) return false
    if (step.powerMin != null && avgSpeedKmh < step.powerMin) return false
    if (step.powerMax != null && avgSpeedKmh > step.powerMax) return false
    return true
  }
  return true
}

/** Earliest duration-keyed window (duration within tolerance) whose metric satisfies the step's band. */
function findThresholdWindowDuration(wattsPrefix, speedPrefix, cursor, step, ftpAtActivityW) {
  const n = (wattsPrefix || speedPrefix || [0]).length - 1
  const { durMin, durMax } = durationRange(step)

  for (let s = cursor; s + durMin <= n; s++) {
    for (let d = durMin; d <= durMax && s + d <= n; d++) {
      const metrics = computeMetrics(wattsPrefix, speedPrefix, s, s + d)
      if (stepBandMatches(metrics, step, ftpAtActivityW)) {
        return { start: s, end: s + d, ...metrics }
      }
    }
  }
  return null
}

/** Single best duration-keyed window (duration within tolerance), optimising `step.bestMetric`. */
function findBestWindowDuration(wattsPrefix, speedPrefix, cursor, step) {
  const metricPrefix = step.bestMetric === 'speed' ? speedPrefix : wattsPrefix
  if (!metricPrefix) return null
  const n = metricPrefix.length - 1
  const { durMin, durMax } = durationRange(step)

  let best = null
  for (let s = cursor; s + durMin <= n; s++) {
    for (let d = durMin; d <= durMax && s + d <= n; d++) {
      const value = windowAvg(metricPrefix, s, s + d)
      if (!best || value > best.value) {
        best = { start: s, end: s + d, value }
      }
    }
  }
  if (!best) return null
  return { start: best.start, end: best.end, ...computeMetrics(wattsPrefix, speedPrefix, best.start, best.end) }
}

/**
 * Earliest distance-keyed window (cumulative distance within tolerance) whose
 * metric satisfies the step's band. Walks `start` forward and tracks the
 * `[eLo, eHi)` range of valid end indices with a two-pointer sweep — both
 * pointers only move forward as `start` advances because removing the
 * oldest second from a window can only shrink its distance (speed >= 0),
 * so a longer window is needed to reach the same distance target.
 */
function findThresholdWindowDistance(wattsPrefix, speedPrefix, cursor, step, ftpAtActivityW) {
  if (!speedPrefix) return null
  const n = speedPrefix.length - 1
  const { distMin, distMax } = distanceRange(step)

  let eLo = cursor
  let eHi = cursor
  for (let s = cursor; s < n; s++) {
    if (eLo < s + 1) eLo = s + 1
    if (eHi < s + 1) eHi = s + 1
    while (eLo <= n && metersAt(speedPrefix, s, eLo) < distMin) eLo++
    while (eHi <= n && metersAt(speedPrefix, s, eHi) <= distMax) eHi++

    for (let e = eLo; e < eHi; e++) {
      const metrics = computeMetrics(wattsPrefix, speedPrefix, s, e)
      if (stepBandMatches(metrics, step, ftpAtActivityW)) {
        return { start: s, end: e, ...metrics, distanceM: metersAt(speedPrefix, s, e) }
      }
    }
  }
  return null
}

/** Single best distance-keyed window (distance within tolerance), optimising `step.bestMetric`. */
function findBestWindowDistance(wattsPrefix, speedPrefix, cursor, step) {
  if (!speedPrefix) return null
  const metricPrefix = step.bestMetric === 'speed' ? speedPrefix : wattsPrefix
  if (!metricPrefix) return null
  const n = speedPrefix.length - 1
  const { distMin, distMax } = distanceRange(step)

  let eLo = cursor
  let eHi = cursor
  let best = null
  for (let s = cursor; s < n; s++) {
    if (eLo < s + 1) eLo = s + 1
    if (eHi < s + 1) eHi = s + 1
    while (eLo <= n && metersAt(speedPrefix, s, eLo) < distMin) eLo++
    while (eHi <= n && metersAt(speedPrefix, s, eHi) <= distMax) eHi++

    for (let e = eLo; e < eHi; e++) {
      const value = windowAvg(metricPrefix, s, e)
      if (!best || value > best.value) {
        best = { start: s, end: e, value, distanceM: metersAt(speedPrefix, s, e) }
      }
    }
  }
  if (!best) return null
  return {
    start: best.start,
    end: best.end,
    ...computeMetrics(wattsPrefix, speedPrefix, best.start, best.end),
    distanceM: best.distanceM,
  }
}

/**
 * @param {{watts: number[], speed: number[], steps: object[], repeatCount: number, ftpAtActivityW: number|null}} args
 *   `steps` come from src/lib/intervalDsl.js's parseIntervalDsl (role, keyBy, targetDurationSec,
 *   targetDistanceM, durationTolerancePct, bandType, bestMetric, powerMin, powerMax), in DSL
 *   declaration order (typically [work] or [work, recovery]). `speed` is the per-second km/h
 *   stream; required for distance-keyed steps, unused otherwise.
 */
export function detectCustomIntervalSequence({ watts = [], speed = [], steps = [], repeatCount = 1, ftpAtActivityW = null }) {
  if ((!watts.length && !speed.length) || !steps.length) {
    return { pattern: 'custom_intervals', efforts: [] }
  }

  const n = Math.max(watts.length, speed.length)
  const hasWatts = watts.length > 0
  const hasSpeed = speed.some((v) => (v || 0) > 0)
  const wattsPrefix = hasWatts ? buildPrefixSum(watts, n) : null
  const speedPrefix = hasSpeed ? buildPrefixSum(speed.map((v) => Math.max(0, v || 0)), n) : null

  const hasDistanceStep = steps.some((s) => s.keyBy === 'distance')
  if (hasDistanceStep && !speedPrefix) {
    return {
      pattern: 'custom_intervals',
      efforts: [],
      message: 'No speed stream available on this activity to match distance-keyed steps.',
    }
  }

  const efforts = []
  let cursor = 0

  for (let rep = 0; rep < repeatCount; rep++) {
    const repWindows = []
    let repCursor = cursor

    for (const step of steps) {
      const isDistance = step.keyBy === 'distance'
      const found = isDistance
        ? step.bandType === 'best'
          ? findBestWindowDistance(wattsPrefix, speedPrefix, repCursor, step)
          : findThresholdWindowDistance(wattsPrefix, speedPrefix, repCursor, step, ftpAtActivityW)
        : step.bandType === 'best'
        ? findBestWindowDuration(wattsPrefix, speedPrefix, repCursor, step)
        : findThresholdWindowDuration(wattsPrefix, speedPrefix, repCursor, step, ftpAtActivityW)

      if (!found) {
        repWindows.length = 0
        break
      }

      repWindows.push({ step, found })
      repCursor = found.end
    }

    // No complete work(+recovery) cycle could be found starting here: the
    // stream is exhausted or no more valid windows exist — stop, we've
    // collected however many complete reps we could ("at least N" semantics).
    if (!repWindows.length) break

    repWindows.forEach(({ step, found }) => {
      const avgPower = found.avgPower != null ? Math.round(found.avgPower) : null
      const avgSpeedKmh = found.avgSpeedKmh != null ? Math.round(found.avgSpeedKmh * 10) / 10 : null
      const segWatts = hasWatts && avgPower != null ? watts.slice(found.start, found.end) : []
      const maxPower = segWatts.length ? Math.max(...segWatts) : null

      const effort = {
        id: `custom_${step.role}_${found.start}`,
        role: step.role,
        start_sec: found.start,
        end_sec: found.end,
        duration_sec: found.end - found.start,
        avg_power: avgPower,
        max_power: maxPower,
        band_type: step.bandType,
        ...(step.bandType === 'best' ? { best_metric: step.bestMetric } : {}),
        ...(avgSpeedKmh != null ? { avg_speed_kmh: avgSpeedKmh } : {}),
        ...(ftpAtActivityW && avgPower != null ? { pct_of_ftp: Math.round((avgPower / ftpAtActivityW) * 1000) / 10 } : {}),
      }

      if (step.keyBy === 'distance') {
        effort.target_distance_m = step.targetDistanceM
        effort.distance_m = found.distanceM != null ? Math.round(found.distanceM) : null
        effort.estimated_time_sec = found.end - found.start
      }

      efforts.push(effort)
    })

    cursor = repCursor
  }

  return { pattern: 'custom_intervals', efforts }
}

