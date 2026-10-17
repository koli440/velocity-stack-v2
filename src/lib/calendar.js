// Pure calendar logic (grid building, week grouping, summaries) for the calendar view.
// Days are local calendar days identified by "YYYY-MM-DD" keys. Weeks start on Monday.
//
// Day items share one event model so planned workouts can be added later next to activities:
//   { id, kind: 'activity' | 'planned', date: Date, title, discipline, distanceM, durationS,
//     metric: { label, value } | null, href }

export const CALENDAR_ACTIVITY_COLUMNS = [
  'id',
  'title',
  'activity_date',
  'track_id',
  'distance_m',
  'moving_time_s',
  'avg_power_w',
  'avg_speed_kmh',
  'training_load',
].join(', ')

export function dayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

export function startOfWeek(date) {
  const d = startOfDay(date)
  return addDays(d, -((d.getDay() + 6) % 7))
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Weeks (arrays of 7 Dates) covering the month of `anchor`, padded to full Mon-Sun weeks. */
export function buildMonthGrid(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return buildWeeks(startOfWeek(first), startOfWeek(last))
}

function buildWeeks(firstWeekStart, lastWeekStart) {
  const weeks = []
  for (let s = firstWeekStart; s <= lastWeekStart; s = addDays(s, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)))
  }
  return weeks
}

/** Half-open local range [start, end) covered by a grid, as ISO strings for querying. */
export function gridRange(weeks) {
  const start = weeks[0][0]
  const end = addDays(weeks[weeks.length - 1][6], 1)
  return { start, end, startISO: start.toISOString(), endISO: end.toISOString() }
}

export function monthRange(anchor) {
  return gridRange(buildMonthGrid(anchor))
}

/** Moves the anchor by `direction` (-1 / +1) months. */
export function shiftMonth(anchor, direction) {
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
}

export function activityToEvent(row) {
  const date = new Date(row.activity_date)
  if (Number.isNaN(date.getTime())) return null
  let metric = null
  if (row.avg_power_w) metric = { label: 'W', value: `${Math.round(row.avg_power_w)} W` }
  else if (row.avg_speed_kmh) metric = { label: 'km/h', value: `${Number(row.avg_speed_kmh).toFixed(1)} km/h` }
  else if (row.training_load) metric = { label: 'TL', value: `TL ${Math.round(row.training_load)}` }
  return {
    id: row.id,
    kind: 'activity',
    date,
    title: row.title || 'Untitled session',
    discipline: row.track_id ? 'track' : 'ride',
    distanceM: Number(row.distance_m) || 0,
    durationS: Number(row.moving_time_s) || 0,
    metric,
    href: `/activities/${row.id}`,
  }
}

/** Groups events by local day key, sorted by time within each day. */
export function groupEventsByDay(events) {
  const map = {}
  for (const e of events) {
    if (!e) continue
    const k = dayKey(e.date)
    ;(map[k] ||= []).push(e)
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => a.date - b.date)
  return map
}

export function summarizeEvents(events) {
  return events.reduce(
    (acc, e) => {
      acc.count += 1
      acc.durationS += e.durationS || 0
      acc.distanceM += e.distanceM || 0
      return acc
    },
    { count: 0, durationS: 0, distanceM: 0 }
  )
}

/**
 * Turns week rows + events into rows of day cells with a per-week summary.
 * Cells: { date, key, inMonth, isToday, events }.
 */
export function buildCalendarRows(weeks, events, { anchor, today = new Date() } = {}) {
  const byDay = groupEventsByDay(events)
  const todayKey = dayKey(today)
  return weeks.map((days) => {
    const cells = days.map((date) => {
      const key = dayKey(date)
      return {
        date,
        key,
        inMonth: anchor ? date.getMonth() === anchor.getMonth() : true,
        isToday: key === todayKey,
        events: byDay[key] || [],
      }
    })
    return { cells, summary: summarizeEvents(cells.flatMap((c) => c.events)) }
  })
}

export function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function formatKm(meters) {
  return `${((meters || 0) / 1000).toFixed(1)} km`
}

/**
 * Default data fetcher: a rider's activities within [startISO, endISO).
 * RLS decides what is visible; later a coach can pass an athlete's id.
 */
export async function fetchActivitiesInRange(client, { riderId, startISO, endISO }) {
  if (!riderId) return { data: [], error: null }
  const { data, error } = await client
    .from('activities')
    .select(CALENDAR_ACTIVITY_COLUMNS)
    .eq('user_id', riderId)
    .gte('activity_date', startISO)
    .lt('activity_date', endISO)
    .order('activity_date', { ascending: true })
    .order('id', { ascending: true })
  if (error) return { data: [], error }
  return { data: (data || []).map(activityToEvent).filter(Boolean), error: null }
}
