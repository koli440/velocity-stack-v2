// Pure calendar logic (grid building, week grouping, summaries) for the calendar view.
// Days are local calendar days identified by "YYYY-MM-DD" keys. Weeks start on Monday.
//
// Day items share one event model so planned workouts can be added later next to activities:
//   { id, kind: 'activity' | 'planned', date: Date, title, discipline, distanceM, durationS,
//     metric: { label, value } | null, href }
// Planned workouts (src/lib/plannedWorkouts.js, kind 'planned', with a `status`) share the model but do not count in week totals.
// Calendar notes (src/lib/calendarNotes.js) are not timed events: they sit on the day cell as `cell.notes`;
// races (src/lib/calendarRaces.js) likewise as `cell.races`, and the week summary lists them as `summary.races`.

import { groupNotesByDay } from './calendarNotes.js'
import { groupRacesByDay } from './calendarRaces.js'

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
  'is_race',
  'activity_type',
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

/** "YYYY-MM" key of the month shown (used in the URL so a view can be restored). */
export function monthParam(anchor) {
  return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`
}

/** Parses a "YYYY-MM" value into the first day of that month, or null. */
export function parseMonthParam(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null
}

export function activityToEvent(row) {
  const date = new Date(row.activity_date)
  if (Number.isNaN(date.getTime())) return null
  let metric = null
  if (row.avg_power_w) metric = { label: 'W', value: `${Math.round(row.avg_power_w)} W` }
  else if (row.avg_speed_kmh) metric = { label: 'km/h', value: `${Number(row.avg_speed_kmh).toFixed(1)} km/h` }
  else if (row.training_load) metric = { label: 'TL', value: `TL ${Math.round(row.training_load)}` }
  else if (row.avg_hr) metric = { label: 'bpm', value: `${Math.round(row.avg_hr)} bpm` }
  return {
    id: row.id,
    kind: 'activity',
    date,
    title: row.title || 'Untitled session',
    discipline: row.activity_type === 'gym' ? 'gym' : row.track_id ? 'track' : 'ride',
    distanceM: Number(row.distance_m) || 0,
    durationS: Number(row.moving_time_s) || 0,
    metric,
    isRace: row.is_race === true,
    href: `/activities/${row.id}`,
  }
}

/** Chip label of a completed activity: "Gym", "Track" (velodrome session) or "Ride". Visual only, track counts as a ride. */
export const activityChipLabel = (event) => (event?.discipline === 'gym' ? 'Gym' : event?.discipline === 'track' ? 'Track' : 'Ride')

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

/**
 * Week totals: `count` / `durationS` / `distanceM` cover completed activities only. Planned workouts are summed
 * separately: `plannedCount` / `plannedDurationS` skip skipped workouts (linked and missed ones count, so the gap
 * to the done time stays visible); `plannedPartial` is true when a counted workout has no computable duration
 * (no structure, or distance-based steps that were left out). `raceActivityCount` = completed activities tagged as race.
 */
export function summarizeEvents(events) {
  return events.reduce(
    (acc, e) => {
      if (e.kind === 'planned') {
        if (e.status === 'skipped') return acc
        acc.plannedCount += 1
        acc.plannedDurationS += e.durationS || 0
        if (!e.durationS || e.durationPartial) acc.plannedPartial = true
        return acc
      }
      acc.count += 1
      if (e.isRace) acc.raceActivityCount += 1
      acc.durationS += e.durationS || 0
      acc.distanceM += e.distanceM || 0
      return acc
    },
    { count: 0, durationS: 0, distanceM: 0, plannedCount: 0, plannedDurationS: 0, plannedPartial: false, raceActivityCount: 0 }
  )
}

/**
 * Turns week rows + events into rows of day cells with a per-week summary.
 * Cells: { date, key, inMonth, isToday, events, notes, races }; summary.races = the week's races in date order.
 */
export function buildCalendarRows(weeks, events, { anchor, today = new Date(), notes = [], races = [] } = {}) {
  const byDay = groupEventsByDay(events)
  const notesByDay = groupNotesByDay(notes)
  const racesByDay = groupRacesByDay(races)
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
        notes: notesByDay[key] || [],
        races: racesByDay[key] || [],
      }
    })
    return { cells, summary: { ...summarizeEvents(cells.flatMap((c) => c.events)), races: cells.flatMap((c) => c.races) } }
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
 * RLS decides what is visible; a coach passes an athlete's id with `shared: true`.
 */
export async function fetchActivitiesInRange(client, { riderId, startISO, endISO, shared = false }) {
  if (!riderId) return { data: [], error: null }
  // A coach reads an athlete through the masked view (never the raw table with GPS).
  const { data, error } = await client
    .from(shared ? 'shared_activities' : 'activities')
    .select(CALENDAR_ACTIVITY_COLUMNS)
    .eq('user_id', riderId)
    .gte('activity_date', startISO)
    .lt('activity_date', endISO)
    .order('activity_date', { ascending: true })
    .order('id', { ascending: true })
  if (error) return { data: [], error }
  return { data: (data || []).map(activityToEvent).filter(Boolean), error: null }
}
