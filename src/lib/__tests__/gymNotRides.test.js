import test from 'node:test'
import assert from 'node:assert/strict'
import { activityToEvent, activityChipLabel } from '../calendar.js'
import { linkableActivities, suggestMatches } from '../plannedWorkouts.js'
import { linkableRaceActivities, checkRaceLink } from '../calendarRaces.js'
import { weeklyVolume } from '../coachContext.js'
import { findCurveGaps, findHeartrateGaps } from '../server/stravaRepair.js'
import { buildSessionSearch } from '../sessionSearch.js'

const day = '2027-01-05'
const at = (h) => new Date(2027, 0, 5, h)
const ride = { id: 'r', kind: 'activity', date: at(8), discipline: 'ride', durationS: 3600 }
const track = { id: 't', kind: 'activity', date: at(9), discipline: 'track', durationS: 3600 }
const gym = { id: 'g', kind: 'activity', date: at(18), discipline: 'gym', durationS: 3600 }

test('calendar labels: gym sessions are Gym, rides and track sessions stay Ride', () => {
  const e = (row) => activityToEvent({ id: 1, activity_date: '2027-01-05T10:00:00Z', ...row })
  assert.equal(activityChipLabel(e({ activity_type: 'gym' })), 'Gym')
  assert.equal(activityChipLabel(e({ activity_type: 'gym', track_id: 'x' })), 'Gym')
  assert.equal(activityChipLabel(e({ activity_type: 'ride' })), 'Ride')
  assert.equal(activityChipLabel(e({})), 'Ride')
  assert.equal(activityChipLabel(e({ track_id: 'x' })), 'Ride')
  assert.equal(e({ track_id: 'x' }).discipline, 'track')
})

test('manual planned-workout links never mix gym sessions and rides', () => {
  const ids = (w) => linkableActivities(w, [], [ride, track, gym]).map((a) => a.id)
  assert.deepEqual(ids({ id: 'w', workout_date: day, discipline: 'gym' }), ['g'])
  assert.deepEqual(ids({ id: 'w', workout_date: day, discipline: 'ride' }), ['r', 't'])
  assert.deepEqual(ids({ id: 'w', workout_date: day, discipline: 'track' }), ['t', 'r'])
})

test('suggested matches keep gym and rides apart', () => {
  const ws = [
    { id: 'wg', workout_date: day, discipline: 'gym', created_at: '1' },
    { id: 'wr', workout_date: day, discipline: 'ride', created_at: '2' },
  ]
  const m = suggestMatches(ws, [ride, gym])
  assert.equal(m.get('wg'), 'g')
  assert.equal(m.get('wr'), 'r')
})

test('a gym session cannot be linked to a race', () => {
  const race = { id: 'x', race_date: day }
  assert.deepEqual(linkableRaceActivities(race, [], [ride, gym], day).map((a) => a.id), ['r'])
  assert.ok(checkRaceLink({ day, activityId: 'g', activities: [gym] }))
  assert.equal(checkRaceLink({ day, activityId: 'r', activities: [ride] }), null)
})

test('coach dashboard volume is rides only and reports gym separately', () => {
  assert.equal(weeklyVolume({ week_count: 2, week_gym_count: 3 }).gymSessions, 3)
  assert.equal(weeklyVolume({ week_count: 2 }).gymSessions, 0)
})

function recorder(rows) {
  const calls = []
  const q = {
    select: () => q,
    eq: (c, v) => (calls.push([c, v]), q),
    is: () => q,
    in: () => Promise.resolve({ data: [], error: null }),
    order: () => q,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { calls, service: { from: () => q } }
}

test('Strava repair only looks at rides, never gym sessions', async () => {
  const a = recorder([])
  await findCurveGaps(a.service, 'u')
  assert.ok(a.calls.some(([c, v]) => c === 'activity_type' && v === 'ride'))
  const b = recorder([])
  await findHeartrateGaps(b.service, 'u')
  assert.ok(b.calls.some(([c, v]) => c === 'activity_type' && v === 'ride'))
})

test('session search still finds gym sessions by title', () => {
  assert.match(buildSessionSearch('legs').orFilter, /title\.ilike/)
})

test('track sessions get their own label but stay rides', async () => {
  const { isTrackActivity, normalizeActivityType } = await import('../activityType.js')
  assert.equal(isTrackActivity({ activity_type: 'ride', track_id: 'x' }), true)
  assert.equal(isTrackActivity({ track_id: null }), false)
  assert.equal(isTrackActivity({ activity_type: 'gym', track_id: 'x' }), false)
  assert.equal(normalizeActivityType('ride'), 'ride')
  const e = activityToEvent({ id: 1, activity_date: '2027-01-05T10:00:00Z', track_id: 'x' })
  assert.equal(activityChipLabel(e), 'Track')
  assert.equal(activityChipLabel({ discipline: 'ride' }), 'Ride')
})
