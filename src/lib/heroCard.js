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

/** @returns {{ kind: 'power', data: object[] } | { kind: 'summary', items: object[] }} */
export function heroCardContent(act) {
  const data = powerPreviewSeries(act?.power_preview)
  if (data) return { kind: 'power', data }
  return { kind: 'summary', items: summaryMetrics(act) }
}
