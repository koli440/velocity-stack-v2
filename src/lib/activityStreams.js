// src/lib/activityStreams.js
//
// Turns an activity's raw 1Hz `time_series` (watts, cadence, torque, speed, heartrate — see
// api/analyze.py) into a single array of chart-ready points, sampled either "by time" (seconds
// since start) or "by distance" (cumulative meters, integrated from the speed stream since FIT
// files don't always carry a per-sample distance field). Used by ActivityStreamsChart (issue #12).

export const STREAM_METRICS = [
  { key: 'speed', label: 'Speed', unit: 'km/h', color: '#38bdf8', decimals: 1 },
  { key: 'heartrate', label: 'Heart Rate', unit: 'bpm', color: '#ef4444', decimals: 0 },
  { key: 'watts', label: 'Power', unit: 'W', color: '#a855f7', decimals: 0 },
  { key: 'cadence', label: 'Cadence', unit: 'RPM', color: '#f97316', decimals: 0 },
  { key: 'torque', label: 'Torque', unit: 'Nm', color: '#eab308', decimals: 1 },
]

/**
 * @param {number} seconds
 * @returns {string} "mm:ss" (or "h:mm:ss" past one hour)
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

/**
 * @param {object} timeSeries - { watts, cadence, torque, speed, heartrate }
 * @param {'time'|'distance'} mode
 * @returns {Array<object>} one point per sample: { x, label, watts, cadence, torque, speed, heartrate }
 */
export function buildStreamSeries(timeSeries = {}, mode = 'time') {
  if (!timeSeries || typeof timeSeries !== 'object') return []

  const length = Math.max(
    ...STREAM_METRICS.map((m) => (Array.isArray(timeSeries[m.key]) ? timeSeries[m.key].length : 0)),
    0
  )
  if (length === 0) return []

  const speedStream = Array.isArray(timeSeries.speed) ? timeSeries.speed : []

  let cumulativeDistanceM = 0
  const points = new Array(length)

  for (let i = 0; i < length; i++) {
    // ~1Hz sampling: each index is ~1 second, so speed (km/h) / 3.6 approximates meters covered.
    // x marks the start of this sample (so, like time mode, the first point is always 0).
    const x = mode === 'distance' ? Math.round(cumulativeDistanceM) : i
    const point = { x }
    STREAM_METRICS.forEach(({ key }) => {
      const stream = timeSeries[key]
      const value = Array.isArray(stream) ? stream[i] : undefined
      point[key] = value === undefined || value === null ? null : Number(value)
    })
    points[i] = point

    const speedKmh = speedStream[i] ?? 0
    cumulativeDistanceM += (Number(speedKmh) || 0) / 3.6
  }

  return points
}

/**
 * @param {number} x - raw point.x (seconds for 'time' mode, meters for 'distance' mode)
 * @param {'time'|'distance'} mode
 * @returns {string}
 */
export function formatAxisTick(x, mode) {
  return mode === 'distance' ? `${(x / 1000).toFixed(1)}km` : formatElapsed(x)
}
