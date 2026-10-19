// Rider power profile (issue #213): maps a durational curves object to the 7 radar axes.
// Pure and reusable (e.g. per-activity profiles on feed hero cards).
import { wattsPerKg } from './wkg.js'

export const POWER_PROFILE_AXES = Object.freeze([
  { key: '15s', label: '15s' },
  { key: '1m', label: '1min' },
  { key: '3m', label: '3min' },
  { key: '5m', label: '5min' },
  { key: '10m', label: '10min' },
  { key: '20m', label: '20min' },
  { key: '1h', label: '1hr' },
])

function pointValue(raw) {
  const v = raw && typeof raw === 'object' ? raw.value : raw
  const n = Number(v)
  return v != null && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Maps a power curve ({ '15s': 900 } or baseline points { '15s': { value } }), or a curves
 * object keyed by metric ({ Power: {...} }), to the 7 axis points. Missing axes yield value null.
 * With weightKg, values are converted to W/kg (null when weight is unavailable).
 */
export function mapCurvesToProfile(curves, { weightKg = null, perKg = false } = {}) {
  const curve = curves && typeof curves.Power === 'object' && curves.Power ? curves.Power : curves || {}
  return POWER_PROFILE_AXES.map(({ key, label }) => {
    const watts = pointValue(curve[key])
    const value = perKg ? wattsPerKg(watts, weightKg) : watts
    return { key, label, value }
  })
}

/** Merges named series into recharts rows: [{ label, <seriesKey>: value|null }]. */
export function buildRadarData(series) {
  return POWER_PROFILE_AXES.map(({ key, label }, i) => {
    const row = { key, label }
    for (const [name, points] of Object.entries(series)) row[name] = points[i]?.value ?? null
    return row
  })
}

export function hasProfileData(points) {
  return points.some((p) => p.value != null)
}

export const RECENT_COLOR = '#a855f7'

// All-time must stand out against the purple series in both themes.
export function allTimeStyle(isDark) {
  return { stroke: isDark ? '#fbbf24' : '#334155', strokeWidth: 1 }
}
