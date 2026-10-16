// src/lib/pbVault.js
//
// "PB Vault" - migrated from v1's pages/30_PB_vault.py + pages/31_PB_detail.py (+ the
// load_discipline_data / get_track_laps_info helpers in utils.py). v1 stored PBs in a Google
// Sheet keyed by a free-text UserID; v2 persists them in the `personal_bests` table (see
// supabase/migrations/20261007000000_personal_bests.sql), scoped to the authenticated user via
// RLS. Disciplines are shared reference data read from the `disciplines` table
// (src/lib/lookups.js); users suggest new ones and an admin approves them.

export const SPLIT_MODES = {
  LAPS: 'laps',
  DISTANCE: 'distance',
}

/**
 * Formats a duration in seconds as v1's `format_time()` does: `M:SS.mmm`, e.g. 210 -> "3:30.000".
 * Mirrors Python's `:06.3f` zero-padding on the seconds portion.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(Number(totalSeconds)) || totalSeconds < 0) {
    return '--:--'
  }
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`
}

/**
 * Parses a minutes/seconds pair (as entered via two separate inputs, like v1's m/s number_input
 * widgets) into total seconds.
 * @param {number} minutes
 * @param {number} seconds
 * @returns {number}
 */
export function minutesSecondsToTotalSeconds(minutes, seconds) {
  return (Number(minutes) || 0) * 60 + (Number(seconds) || 0)
}

/**
 * Splits total seconds back into whole minutes + remaining seconds, for pre-filling the edit
 * form's separate Min/Sec inputs (mirrors v1's 31_PB_detail.py edit panel).
 * @param {number} totalSeconds
 * @returns {{ minutes: number, seconds: number }}
 */
export function totalSecondsToMinutesSeconds(totalSeconds) {
  const safe = Number(totalSeconds) || 0
  return {
    minutes: Math.floor(safe / 60),
    seconds: Number((safe % 60).toFixed(3)),
  }
}

/**
 * Average speed (km/h) over a given distance (m) and time (s), same formula as v1's
 * `avg_speed = (discipline_dist / total_seconds) * 3.6`.
 * @param {number} distanceM
 * @param {number} totalSeconds
 * @returns {number}
 */
export function calculateAvgSpeedKmh(distanceM, totalSeconds) {
  if (!distanceM || !totalSeconds || totalSeconds <= 0) return 0
  return Math.round((distanceM / totalSeconds) * 3.6 * 100) / 100
}

/**
 * Works out how many splits of `segmentDistanceM` fit in `totalDistanceM`, same integer-division
 * v1 used to cap the number of lap/split input fields it rendered.
 * @param {number} totalDistanceM
 * @param {number} segmentDistanceM
 * @returns {number}
 */
export function countSplits(totalDistanceM, segmentDistanceM) {
  if (!totalDistanceM || !segmentDistanceM || segmentDistanceM <= 0) return 0
  return Math.floor(totalDistanceM / segmentDistanceM)
}

/**
 * Builds the per-segment analysis table v1's 31_PB_detail.py renders from a flat array of lap/
 * split times: cumulative race time, speed and distance covered at each segment.
 * @param {number[]} lapTimes
 * @param {number} segmentDistanceM
 * @returns {{ segment: number, time: number, totalTime: number, speedKmh: number, distanceM: number }[]}
 */
export function buildLapAnalysis(lapTimes, segmentDistanceM) {
  if (!Array.isArray(lapTimes) || lapTimes.length === 0) return []
  let cumulative = 0
  return lapTimes.map((time, index) => {
    cumulative += time
    const speedKmh = time > 0 ? (segmentDistanceM / time) * 3.6 : 0
    return {
      segment: index + 1,
      time,
      totalTime: cumulative,
      speedKmh: Math.round(speedKmh * 100) / 100,
      distanceM: segmentDistanceM * (index + 1),
    }
  })
}

/**
 * Formats an ISO (YYYY-MM-DD) date string as v1's `format_date()` did: `DD. MM. YYYY`.
 * @param {string} isoDate
 * @returns {string}
 */
export function formatDate(isoDate) {
  if (!isoDate) return ''
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}. ${month}. ${date.getFullYear()}`
}
