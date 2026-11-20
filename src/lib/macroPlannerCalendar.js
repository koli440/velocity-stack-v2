// Macro planner races come from the athlete's calendar (calendar_races): the coach selects, never types, a race.
// Pure helpers for the selection lists and the "needs attention" messages (docs/macro-planner.md).

import { fetchRacesInRange } from './calendarRaces.js'

const FAR_FUTURE = '2100-12-31'

/** Upcoming calendar races the coach can pick: today or later, not already used by the plan, soonest first. */
export function selectableRaces(calendarRaces, { today, usedIds = [], before = null } = {}) {
  const used = new Set((usedIds || []).filter(Boolean))
  return (calendarRaces || [])
    .filter((r) => r?.id && r.race_date >= today && !used.has(r.id) && (!before || r.race_date < before))
    .sort((a, b) => (a.race_date === b.race_date ? String(a.name).localeCompare(String(b.name)) : a.race_date < b.race_date ? -1 : 1))
}

/** One-line option label: "2027-05-30 · Nationals (Road, Frankfurt)". Name, date and place come from the calendar. */
export function raceOptionLabel(r) {
  const extra = [r.format_note, r.location].map((x) => String(x || '').trim()).filter(Boolean).join(', ')
  return `${r.race_date} · ${r.name}${extra ? ` (${extra})` : ''}`
}

export const ATTENTION_TEXT = {
  race_unlinked: 'This plan is not linked to a calendar race yet. Select the A race from the athlete\'s calendar and save.',
  race_deleted: 'The A race was deleted from the athlete\'s calendar. The plan is kept: select another calendar race and save, or add the race back first.',
  race_moved: 'A race in the athlete\'s calendar was moved. The plan follows the new date; check the weeks, then mark the plan as reviewed (or regenerate and save).',
  minor_race_deleted: 'A B/C race was deleted from the athlete\'s calendar. Remove it from the plan or select another calendar race.',
}

/** Message for the plan's attention flag, or null. */
export function attentionMessage(attention) {
  return ATTENTION_TEXT[attention] || null
}

/** Only a moved race can be acknowledged; the other flags need the coach to relink or remove a race. */
export const canAcknowledge = (attention) => attention === 'race_moved'

/** The athlete's upcoming calendar races (RLS: the athlete or an active coach). */
export function fetchUpcomingCalendarRaces(client, riderId, today) {
  return fetchRacesInRange(client, { riderId, startDay: today, endDay: FAR_FUTURE })
}

export const addRaceToCalendarHref = (riderId) => `/coach/${riderId}/calendar`
