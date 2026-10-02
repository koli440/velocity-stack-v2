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
}) {
  const { watts = [], cadence = [], torque = [] } = timeSeries

  if (!watts.length && !cadence.length) {
    return { pattern: 'none', efforts: [], message: 'Missing per-second data for analysis.' }
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