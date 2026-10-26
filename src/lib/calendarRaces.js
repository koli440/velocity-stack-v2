// Pure logic for calendar races (supabase/migrations/20261210000000_calendar_races.sql): a race / event on
// ONE day of a rider's calendar, written by the rider or the rider's active coach.
// The database enforces access, limits, author stamps and that a linked activity belongs to the rider;
// this module validates input for friendly errors, derives labels, groups races per day and applies the
// UI-only "same day" link rule (the server has no timezone).

import { isDayKey, noteAuthorLabel, noteEditedLabel, noteProfileIds } from './calendarNotes.js'

export const RACE_NAME_MAX = 80
export const RACE_LOCATION_MAX = 120
export const RACE_FORMAT_MAX = 200
export const RACE_NOTES_MAX = 1000
export const RACE_COLUMNS =
  'id, rider_id, race_date, race_time, name, discipline, priority, location, format_note, notes, activity_id, created_by, updated_by, set_by_coach, created_at, updated_at'

export const RACE_DISCIPLINES = ['ride', 'track', 'other']
export const RACE_DISCIPLINE_LABELS = { ride: 'Ride', track: 'Track', other: 'Other' }
export const RACE_PRIORITIES = ['A', 'B', 'C']
export const RACE_PRIORITY_LABELS = { A: 'A race (main goal)', B: 'B race', C: 'C race' }
// Tailwind classes per priority: A red, B amber, C slate.
export const RACE_PRIORITY_STYLES = {
  A: 'border-rose-500/80 bg-rose-500/15 text-rose-800 dark:text-rose-200',
  B: 'border-orange-400/80 bg-orange-400/15 text-orange-800 dark:text-orange-200',
  C: 'border-slate-400/80 bg-slate-400/15 text-slate-700 dark:text-slate-200',
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/** Trims and validates a draft; returns { value } (DB-ready fields) or { error }. */
export function validateRace({ name, discipline = 'ride', priority = 'B', time = '', location = '', formatNote = '', notes = '', activityId = null } = {}) {
  const n = String(name ?? '').trim()
  const loc = String(location ?? '').trim()
  const fmt = String(formatNote ?? '').trim()
  const nt = String(notes ?? '').trim()
  const t = String(time ?? '').trim()
  if (!n) return { error: 'Add a race name.' }
  if (n.length > RACE_NAME_MAX) return { error: `Name is limited to ${RACE_NAME_MAX} characters.` }
  if (!RACE_DISCIPLINES.includes(discipline)) return { error: 'Pick a discipline.' }
  if (!RACE_PRIORITIES.includes(priority)) return { error: 'Pick a priority (A, B or C).' }
  if (t && !TIME_RE.test(t)) return { error: 'Start time must look like 14:30.' }
  if (loc.length > RACE_LOCATION_MAX) return { error: `Location is limited to ${RACE_LOCATION_MAX} characters.` }
  if (fmt.length > RACE_FORMAT_MAX) return { error: `Format / distance is limited to ${RACE_FORMAT_MAX} characters.` }
  if (nt.length > RACE_NOTES_MAX) return { error: `Notes are limited to ${RACE_NOTES_MAX} characters.` }
  return {
    value: {
      name: n,
      discipline,
      priority,
      race_time: t || null,
      location: loc,
      format_note: fmt,
      notes: nt,
      activity_id: activityId || null,
    },
  }
}

export const raceAuthorLabel = noteAuthorLabel
export const raceEditedLabel = noteEditedLabel
export const raceProfileIds = noteProfileIds

/** "14:30" from a Postgres TIME ("14:30:00"), '' when unset. */
export function raceTimeLabel(race) {
  return race?.race_time ? String(race.race_time).slice(0, 5) : ''
}

/** Groups races by their "YYYY-MM-DD" day: by start time (untimed last), then creation. */
export function groupRacesByDay(races) {
  const map = {}
  for (const r of races || []) {
    if (!r || !isDayKey(r.race_date)) continue
    ;(map[r.race_date] ||= []).push(r)
  }
  const key = (r) => (r.race_time ? String(r.race_time) : '99')
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => key(a).localeCompare(key(b)) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  }
  return map
}

/** Highest priority first (A > B > C) among the given races, or null. */
export function topPriority(races) {
  return RACE_PRIORITIES.find((p) => (races || []).some((r) => r.priority === p)) || null
}

/** Map of activityId -> race for races linked to an activity (used to mark that activity as the race). */
export function racesByActivity(races) {
  const map = new Map()
  for (const r of races || []) if (r?.activity_id) map.set(r.activity_id, r)
  return map
}

/**
 * Activities the race can be linked to: those of the race DAY only (local day, like the calendar cell; a UI
 * rule because the server has no timezone), not linked to another race. `activities` are calendar events.
 * `day` overrides the race's own date (the dialog's currently chosen date).
 */
export function linkableRaceActivities(race, races, activities, day = race?.race_date) {
  const elsewhere = new Set((races || []).filter((r) => r.activity_id && r.id !== race?.id).map((r) => r.activity_id))
  return (activities || []).filter((a) => a && a.kind !== 'planned' && a.discipline !== 'gym' && a.date && localDay(a.date) === day && !elsewhere.has(a.id))
}

function localDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Enforces the same-day rule for a chosen link. Returns an error message or null.
 * `activities` are calendar events of the visible range; a link to an activity outside it cannot be verified
 * and is only allowed to stay as it was (`currentActivityId`) when the date did not change.
 */
export function checkRaceLink({ day, activityId, currentActivityId = null, currentDay = null, activities }) {
  if (!activityId) return null
  const a = (activities || []).find((x) => x.id === activityId)
  if (!a) return activityId === currentActivityId && day === currentDay ? null : 'Pick an activity from this day.'
  if (a.discipline === 'gym') return 'A gym session cannot be a race activity.'
  return localDay(a.date) === day ? null : 'The linked activity must be on the race day. Unlink it or keep the date.'
}

/** Fetches the rider's races of the visible grid range (inclusive day keys). RLS limits who gets rows. */
export async function fetchRacesInRange(client, { riderId, startDay, endDay }) {
  if (!riderId || !isDayKey(startDay) || !isDayKey(endDay)) return { data: [], error: null }
  const { data, error } = await client
    .from('calendar_races')
    .select(RACE_COLUMNS)
    .eq('rider_id', riderId)
    .gte('race_date', startDay)
    .lte('race_date', endDay)
    .order('race_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: [], error }
  return { data: data || [], error: null }
}

// Writes send only the client-writable columns; the database stamps author fields itself.
export async function createRace(client, { riderId, day, ...draft }) {
  const v = validateRace(draft)
  if (v.error) return { data: null, error: new Error(v.error) }
  if (!riderId || !isDayKey(day)) return { data: null, error: new Error('Pick a day.') }
  const { data, error } = await client
    .from('calendar_races')
    .insert({ rider_id: riderId, race_date: day, ...v.value })
    .select(RACE_COLUMNS)
    .single()
  return { data, error }
}

export async function updateRace(client, id, { day, ...draft }) {
  const v = validateRace(draft)
  if (v.error) return { data: null, error: new Error(v.error) }
  if (!id || !isDayKey(day)) return { data: null, error: new Error('Pick a day.') }
  const { data, error } = await client
    .from('calendar_races')
    .update({ race_date: day, ...v.value })
    .eq('id', id)
    .select(RACE_COLUMNS)
    .maybeSingle()
  if (!error && !data) return { data: null, error: new Error('Race not found or no longer editable.') }
  return { data, error }
}

export async function deleteRace(client, id) {
  const { data, error } = await client.from('calendar_races').delete().eq('id', id).select('id')
  if (!error && !(data || []).length) return { error: new Error('Race not found or no longer editable.') }
  return { error }
}
