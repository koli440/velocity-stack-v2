// Calendar-week (Monday-Sunday) bounds and totals in the runtime's local time zone.

// Start of the Monday-based week containing `now`, as a local-midnight Date.
// Built from calendar fields (not +24h arithmetic) so DST changes can't shift it.
export function weekStart(now = new Date()) {
  const daysSinceMonday = (now.getDay() + 6) % 7
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday)
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// Current week [start, end) and previous week [prevStart, start); end is next Monday 00:00 local.
export function weekBounds(now = new Date()) {
  const start = weekStart(now)
  return { prevStart: addDays(start, -7), start, end: addDays(start, 7) }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function activityTimeS(a) {
  return num(a.moving_time_s) ?? num(a.elapsed_time_s) ?? num(a.duration_sec) ?? 0
}

// Sums activities whose activity_date falls in [from, to). TSS is null when no activity has one.
export function sumActivities(activities, from, to) {
  let distanceM = 0
  let timeS = 0
  let tss = null
  let count = 0
  for (const a of activities || []) {
    const t = new Date(a.activity_date).getTime()
    if (!(t >= from.getTime() && t < to.getTime())) continue
    count += 1
    distanceM += num(a.distance_m) ?? 0
    timeS += activityTimeS(a)
    const load = num(a.training_load)
    if (load !== null) tss = (tss ?? 0) + load
  }
  return { distanceM, timeS, tss, count }
}

export function weekTotals(activities, now = new Date()) {
  const { prevStart, start, end } = weekBounds(now)
  return {
    current: sumActivities(activities, start, end),
    previous: sumActivities(activities, prevStart, start),
    bounds: { prevStart, start, end },
  }
}

export function formatDuration(totalS) {
  const m = Math.round(totalS / 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const formatKm = (m) => `${(m / 1000).toFixed(1)} km`
export const formatTss = (tss) => (tss === null ? '-' : String(Math.round(tss)))
