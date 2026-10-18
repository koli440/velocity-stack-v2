// Shared time / distance / speed formatting helpers (previously duplicated in pursuit.js,
// activityStreams.js and pbVault.js, which still re-export them).
import { MPS_TO_KMH } from './constants.js'

/**
 * Formats a duration in seconds as v1's `format_time()` does: `M:SS.mmm`, e.g. 210 -> "3:30.000".
 * Pads the seconds like Python's `:06.3f`. No input validation (see formatTime).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMinSecMs(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`
}

/**
 * Like formatMinSecMs but returns '--:--' for missing, non-numeric or negative input.
 * @param {number|null|undefined} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(Number(totalSeconds)) || totalSeconds < 0) {
    return '--:--'
  }
  return formatMinSecMs(totalSeconds)
}

/**
 * @param {number} seconds
 * @returns {string} "m:ss" (or "h:mm:ss" past one hour)
 */
export function formatElapsed(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/**
 * @param {number} meters
 * @returns {string} distance formatted in km with 2 decimals
 */
export function formatDistanceKm(meters) {
  return `${(Math.max(0, meters || 0) / 1000).toFixed(2)} km`
}

/** Metres per second -> km/h (unrounded). */
export function mpsToKmh(metersPerSecond) {
  return metersPerSecond * MPS_TO_KMH
}

/** Average speed in km/h for a distance covered in a time (unrounded). */
export function avgSpeedKmh(distanceM, seconds) {
  return mpsToKmh(distanceM / seconds)
}
