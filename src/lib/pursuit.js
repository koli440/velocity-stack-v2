// src/lib/pursuit.js
//
// "Pursuit Strategist" - migrated from v1's pages/10_pursuit.py (+ the load_track_data /
// load_discipline_data / get_track_laps_info helpers in utils.py). Given a track, a discipline
// and a target finishing time, this works out a lap-by-lap pacing plan: a standing-start
// penalty on lap 1, then either an even tempo or a linear pacing drift (negative/positive split)
// across the remaining laps, plus the cadence/speed each lap implies for a given gear.
//
// v1 loaded its track and discipline catalogues from a Google Sheet at runtime. v2 already has a
// real `tracks` table in Supabase (reused here, see src/app/velodromes/page.js), but disciplines
// are fixed competition parameters (UCI track distances), not user data, so they're kept as a
// static reference list rather than a new DB table - mirroring the read-only, seed-only way the
// `tracks` table itself is already used elsewhere in the app.

// Standard 700c road wheel circumference in meters (matches the 2.140m constant used in v1 - a
// 28" wheel, 700x23C/25C tyre).
export const WHEEL_CIRCUMFERENCE_M = 2.14

// Fixed catalogue of UCI track cycling disciplines: category, display name, race distance (m)
// and whether the event starts from a flying (rolling) start rather than a standing start.
export const DISCIPLINES = [
  { category: 'Sprint', name: 'Flying 200m', distanceM: 200, flyingStart: true },
  { category: 'Sprint', name: 'Kilo (1km Time Trial)', distanceM: 1000, flyingStart: false },
  { category: 'Sprint', name: '500m Time Trial (Women)', distanceM: 500, flyingStart: false },
  { category: 'Sprint', name: 'Team Sprint (Men, 3 laps)', distanceM: 750, flyingStart: false },
  { category: 'Sprint', name: 'Team Sprint (Women, 2 laps)', distanceM: 500, flyingStart: false },
  { category: 'Pursuit', name: 'Individual Pursuit (Men)', distanceM: 4000, flyingStart: false },
  { category: 'Pursuit', name: 'Individual Pursuit (Women)', distanceM: 3000, flyingStart: false },
  { category: 'Pursuit', name: 'Team Pursuit (Men)', distanceM: 4000, flyingStart: false },
  { category: 'Pursuit', name: 'Team Pursuit (Women)', distanceM: 4000, flyingStart: false },
  { category: 'Endurance', name: 'Scratch Race', distanceM: 10000, flyingStart: false },
  { category: 'Endurance', name: 'Points Race', distanceM: 20000, flyingStart: false },
  { category: 'Endurance', name: 'Madison', distanceM: 30000, flyingStart: false },
]

function round(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Formats a duration in seconds as v1's `format_time()` does: `M:SS.mmm`, e.g. 210 -> "3:30.000".
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  // Pad to width 6 ("SS.mmm") the same way Python's `:06.3f` does.
  return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`
}

/**
 * Works out how many whole laps a discipline's distance makes of a given track, mirroring v1's
 * get_track_laps_info(). Distances that don't land within `tolerance` laps of a whole number are
 * treated as invalid for that track/discipline combo (same as v1 surfacing a "must be longer than
 * 1 lap" style error).
 * @param {number} trackLengthM
 * @param {number} distanceM
 * @param {number} [tolerance]
 * @returns {{ laps: number, valid: boolean }}
 */
export function getTrackLaps(trackLengthM, distanceM, tolerance = 0.05) {
  if (!trackLengthM || trackLengthM <= 0 || !distanceM || distanceM <= 0) {
    return { laps: 0, valid: false }
  }
  const rawLaps = distanceM / trackLengthM
  const fraction = rawLaps - Math.floor(rawLaps)

  if (fraction < tolerance) {
    return { laps: Math.floor(rawLaps), valid: true }
  }
  if (1 - fraction < tolerance) {
    return { laps: Math.ceil(rawLaps), valid: true }
  }
  return { laps: 0, valid: false }
}

/**
 * Classifies a pacing drift value the same way v1's UI messaging does.
 * @param {number} pacingDriftS
 * @returns {'negative'|'positive'|'even'}
 */
export function pacingStrategyLabel(pacingDriftS) {
  if (pacingDriftS < 0) return 'negative'
  if (pacingDriftS > 0) return 'positive'
  return 'even'
}

/**
 * Computes the full lap-by-lap pacing strategy, mirroring the maths in v1's 10_pursuit.py.
 *
 * Lap 1 carries the standing-start penalty, lap 2 is the "base" flying lap time, and every lap
 * after that drifts linearly by `pacingDriftS` per lap (negative = speeding up / negative split,
 * positive = slowing down / positive split). `tBase` is solved for so the sum of all lap times
 * exactly equals `targetSeconds`.
 *
 * @param {object} params
 * @param {number} params.trackLengthM
 * @param {number} params.laps - whole number of laps (from getTrackLaps)
 * @param {number} params.totalDistanceM
 * @param {number} params.targetSeconds - target finishing time, in seconds
 * @param {number} params.startPenaltyS - standing-start penalty added to lap 1, in seconds
 * @param {number} params.pacingDriftS - per-lap drift from lap 3 onward, in seconds
 * @param {number} params.chainring - front chainring tooth count
 * @param {number} params.cog - rear cog tooth count
 * @param {number} [params.wheelCircumferenceM]
 * @returns {null|{
 *   laps: Array<{lap:number, lapTimeS:number, overallTimeS:number, speedKmh:number, cadenceRpm:number}>,
 *   elapsedTimeS: number,
 *   avgSpeedKmh: number,
 *   avgCadenceRpm: number,
 *   avgLapTimeS: number,
 *   firstLapTimeS: number,
 *   avgFlyingLapTimeS: number,
 * }}
 */
export function calculatePursuitStrategy({
  trackLengthM,
  laps,
  totalDistanceM,
  targetSeconds,
  startPenaltyS,
  pacingDriftS,
  chainring,
  cog,
  wheelCircumferenceM = WHEEL_CIRCUMFERENCE_M,
}) {
  const n = Math.round(laps)
  if (!n || n <= 1) return null

  const safeCog = Number(cog) || 1
  const gearRatio = Number(chainring) / safeCog

  // Sum of the arithmetic drift series applied to laps 3..n (i=3 -> 1*drift, i=4 -> 2*drift, ...).
  const sumDriftIntervals = n > 2 ? ((n - 2) * (n - 1)) / 2 : 0
  const tBase = (targetSeconds - startPenaltyS - sumDriftIntervals * pacingDriftS) / n

  const lapsData = []
  let elapsed = 0

  for (let i = 1; i <= n; i++) {
    let lapTime
    if (i === 1) {
      lapTime = tBase + startPenaltyS
    } else if (i === 2) {
      lapTime = tBase
    } else {
      lapTime = tBase + (i - 2) * pacingDriftS
    }

    elapsed += lapTime

    const revolutionsPerLap = trackLengthM / wheelCircumferenceM
    const crankRevolutionsPerLap = revolutionsPerLap / gearRatio
    const lapCadence = (crankRevolutionsPerLap / lapTime) * 60

    lapsData.push({
      lap: i,
      lapTimeS: round(lapTime, 3),
      overallTimeS: round(elapsed, 3),
      speedKmh: round((trackLengthM / lapTime) * 3.6, 1),
      cadenceRpm: Math.round(lapCadence),
    })
  }

  const totalCrankRevs = totalDistanceM / wheelCircumferenceM / gearRatio
  const avgCadenceRpm = (totalCrankRevs / targetSeconds) * 60
  const avgLapTimeS = targetSeconds / n
  const avgSpeedKmh = (totalDistanceM / 1000) / (targetSeconds / 3600)

  const firstLapTimeS = lapsData[0].lapTimeS
  const flyingLaps = lapsData.slice(1)
  const avgFlyingLapTimeS =
    flyingLaps.reduce((sum, l) => sum + l.lapTimeS, 0) / flyingLaps.length

  return {
    laps: lapsData,
    elapsedTimeS: round(elapsed, 3),
    avgSpeedKmh,
    avgCadenceRpm,
    avgLapTimeS,
    firstLapTimeS,
    avgFlyingLapTimeS,
  }
}
