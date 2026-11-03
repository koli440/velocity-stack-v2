// Hero card content (issue #216): the activity's power-over-time series when it has a
// persisted power_preview, otherwise a distance / time / speed summary.
import { powerPreviewSeries } from './powerPreview.js'

function formatTime(sec) {
  if (!sec) return null
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function summaryMetrics(act) {
  const speed = Number(act?.avg_speed_kmh)
  const items = [
    act?.distance_m > 0 && { key: 'distance', value: (act.distance_m / 1000).toFixed(1), unit: 'km' },
    act?.moving_time_s > 0 && { key: 'time', value: formatTime(act.moving_time_s), unit: 'time' },
    Number.isFinite(speed) && speed > 0 && { key: 'speed', value: speed.toFixed(1), unit: 'km/h' },
  ]
  return items.filter(Boolean)
}

const formatCount = (n) => String(Math.round(n))

function formatVolume(kg) {
  if (kg >= 10000) return { value: (kg / 1000).toFixed(1), unit: 't' }
  return { value: String(Math.round(kg)), unit: 'kg' }
}

/**
 * Gym hero tiles: time, exercises, sets, volume (from the session's gym_sets rows, when readable)
 * plus kcal / avg HR when the activity has them. Tiles without a value are left out.
 * @param {object} act
 * @param {{ exercise_id?: string, set_type?: string, reps?: number|null, weight_kg?: number|string|null }[]} [sets]
 */
export function gymSummaryMetrics(act, sets) {
  const active = (Array.isArray(sets) ? sets : []).filter((s) => s && (s.set_type ?? 'active') === 'active')
  const exercises = new Set(active.map((s) => s.exercise_id).filter(Boolean)).size
  const volumeKg = active.reduce((sum, s) => {
    const reps = Number(s.reps)
    const kg = Number(s.weight_kg)
    return reps > 0 && kg > 0 ? sum + reps * kg : sum
  }, 0)
  const calories = Number(act?.calories)
  const hr = Number(act?.avg_hr)
  const volume = volumeKg > 0 ? formatVolume(volumeKg) : null
  const items = [
    act?.moving_time_s > 0 && { key: 'time', icon: 'clock', value: formatTime(act.moving_time_s), unit: 'time' },
    exercises > 0 && { key: 'exercises', icon: 'dumbbell', value: formatCount(exercises), unit: 'exercises' },
    active.length > 0 && { key: 'sets', icon: 'chart', value: formatCount(active.length), unit: 'sets' },
    volume && { key: 'volume', icon: 'trend', value: volume.value, unit: volume.unit },
    calories > 0 && { key: 'kcal', icon: 'flame', value: formatCount(calories), unit: 'kcal' },
    hr > 0 && { key: 'hr', icon: 'heart', value: formatCount(hr), unit: 'bpm avg' },
  ]
  return items.filter(Boolean)
}

/** @returns {{ kind: 'power', data: object[] } | { kind: 'summary' | 'gym', items: object[] }} */
export function heroCardContent(act, gymSets) {
  if (act?.activity_type === 'gym') return { kind: 'gym', items: gymSummaryMetrics(act, gymSets) }
  const data = powerPreviewSeries(act?.power_preview)
  if (data) return { kind: 'power', data }
  return { kind: 'summary', items: summaryMetrics(act) }
}
