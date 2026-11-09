import { formatDuration } from './calendar.js'

// Completed time of one calendar day, same basis as the week total (planned workouts are not counted).
export function dayCompletedDurationS(events) {
  return (events || []).reduce((s, e) => (e.kind === 'planned' ? s : s + (Number(e.durationS) || 0)), 0)
}

export function dayTimeLabel(events) {
  const s = dayCompletedDurationS(events)
  return s > 0 ? formatDuration(s) : null
}
