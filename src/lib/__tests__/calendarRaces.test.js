import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RACE_NAME_MAX,
  RACE_NOTES_MAX,
  validateRace,
  raceTimeLabel,
  groupRacesByDay,
  topPriority,
  racesByActivity,
  linkableRaceActivities,
  checkRaceLink,
  raceAuthorLabel,
  fetchRacesInRange,
  createRace,
  updateRace,
  deleteRace,
} from '../calendarRaces.js'
import { buildMonthGrid, buildCalendarRows } from '../calendar.js'

test('validateRace trims, defaults and enforces enums and limits', () => {
  const ok = validateRace({ name: ' Nats ', discipline: 'track', priority: 'A', time: '14:30', location: ' Brno ' })
  assert.deepEqual(ok.value, { name: 'Nats', discipline: 'track', priority: 'A', race_time: '14:30', location: 'Brno', format_note: '', notes: '', activity_id: null })
  assert.equal(validateRace({ name: 'x' }).value.priority, 'B')
  assert.equal(validateRace({ name: 'x' }).value.race_time, null)
  assert.ok(validateRace({ name: '  ' }).error)
  assert.ok(validateRace({ name: 'x'.repeat(RACE_NAME_MAX + 1) }).error)
  assert.ok(validateRace({ name: 'x', discipline: 'gym' }).error)
  assert.ok(validateRace({ name: 'x', priority: 'D' }).error)
  assert.ok(validateRace({ name: 'x', time: '25:00' }).error)
  assert.ok(validateRace({ name: 'x', notes: 'y'.repeat(RACE_NOTES_MAX + 1) }).error)
  assert.equal(validateRace({ name: 'x', activityId: 'a1' }).value.activity_id, 'a1')
})

test('labels, grouping and priority helpers', () => {
  assert.equal(raceTimeLabel({ race_time: '09:05:00' }), '09:05')
  assert.equal(raceTimeLabel({ race_time: null }), '')
  assert.equal(raceAuthorLabel({ created_by: null, set_by_coach: true }, {}, 'r'), 'former coach')
  const g = groupRacesByDay([
    { id: 'b', race_date: '2026-12-05', race_time: null, created_at: '1' },
    { id: 'a', race_date: '2026-12-05', race_time: '10:00:00', created_at: '2' },
    { id: 'x', race_date: 'bad' },
  ])
  assert.deepEqual(g['2026-12-05'].map((r) => r.id), ['a', 'b'])
  assert.equal(Object.keys(g).length, 1)
  assert.equal(topPriority([{ priority: 'C' }, { priority: 'A' }]), 'A')
  assert.equal(topPriority([]), null)
  assert.equal(racesByActivity([{ id: 'r1', activity_id: 'a1' }, { id: 'r2', activity_id: null }]).get('a1').id, 'r1')
})

const act = (id, d) => ({ id, kind: 'activity', date: d })

test('same-day link rule: only activities of the race day, not linked to another race', () => {
  const race = { id: 'r1', race_date: '2026-12-05', activity_id: null }
  const acts = [act('a1', new Date(2026, 11, 5, 9)), act('a2', new Date(2026, 11, 6, 9)), act('a3', new Date(2026, 11, 5, 15)), { id: 'p', kind: 'planned', date: new Date(2026, 11, 5) }]
  const races = [race, { id: 'r2', race_date: '2026-12-05', activity_id: 'a3' }]
  assert.deepEqual(linkableRaceActivities(race, races, acts).map((a) => a.id), ['a1'])
  assert.deepEqual(linkableRaceActivities(race, races, acts, '2026-12-06').map((a) => a.id), ['a2'])
  assert.equal(checkRaceLink({ day: '2026-12-05', activityId: 'a1', activities: acts }), null)
  assert.ok(checkRaceLink({ day: '2026-12-06', activityId: 'a1', activities: acts }))
  assert.ok(checkRaceLink({ day: '2026-12-05', activityId: 'zzz', activities: acts }))
  assert.equal(checkRaceLink({ day: '2026-12-05', activityId: 'zzz', currentActivityId: 'zzz', currentDay: '2026-12-05', activities: acts }), null)
  assert.ok(checkRaceLink({ day: '2026-12-07', activityId: 'zzz', currentActivityId: 'zzz', currentDay: '2026-12-05', activities: acts }))
  assert.equal(checkRaceLink({ day: '2026-12-05', activityId: '', activities: acts }), null)
})

test('calendar rows carry races per day and list them in the week summary', () => {
  const races = [{ id: 'r1', race_date: '2026-12-10', name: 'Nats', priority: 'A', created_at: '1' }, { id: 'r2', race_date: '2026-12-30', name: 'Late', priority: 'C', created_at: '1' }]
  const rows = buildCalendarRows(buildMonthGrid(new Date(2026, 11, 10)), [], { anchor: new Date(2026, 11, 10), races })
  const cells = rows.flatMap((r) => r.cells)
  assert.deepEqual(cells.find((c) => c.key === '2026-12-10').races.map((r) => r.id), ['r1'])
  assert.equal(cells.find((c) => c.key === '2026-12-11').races.length, 0)
  const week = rows.find((r) => r.cells.some((c) => c.key === '2026-12-10'))
  assert.deepEqual(week.summary.races.map((r) => r.id), ['r1'])
  assert.equal(week.summary.count, 0)
  assert.equal(buildCalendarRows(buildMonthGrid(new Date(2026, 11, 10)), [], {})[0].cells[0].races.length, 0)
})

function fakeClient(result) {
  const calls = []
  const q = {
    select(c) { calls.push(['select', c]); return q },
    insert(v) { calls.push(['insert', v]); return q },
    update(v) { calls.push(['update', v]); return q },
    delete() { calls.push(['delete']); return q },
    eq(k, v) { calls.push(['eq', k, v]); return q },
    gte(k, v) { calls.push(['gte', k, v]); return q },
    lte(k, v) { calls.push(['lte', k, v]); return q },
    order() { return q },
    single: async () => result,
    maybeSingle: async () => result,
    then: (res) => res(result),
  }
  return { from: (t) => { calls.push(['from', t]); return q }, calls }
}

test('fetchRacesInRange filters by rider explicitly and the visible range', async () => {
  const c = fakeClient({ data: [{ id: 'r1' }], error: null })
  const out = await fetchRacesInRange(c, { riderId: 'rid', startDay: '2026-11-30', endDay: '2027-01-03' })
  assert.deepEqual(out.data, [{ id: 'r1' }])
  assert.deepEqual(c.calls.find((x) => x[0] === 'eq'), ['eq', 'rider_id', 'rid'])
  assert.ok(c.calls.some((x) => x[0] === 'gte' && x[2] === '2026-11-30'))
  assert.deepEqual((await fetchRacesInRange(c, { riderId: null, startDay: '2026-11-30', endDay: '2027-01-03' })).data, [])
})

test('writes send only client-writable columns and validate first', async () => {
  const c = fakeClient({ data: { id: 'r1' }, error: null })
  await createRace(c, { riderId: 'rid', day: '2026-12-05', name: 'Nats', priority: 'A', discipline: 'track' })
  const ins = c.calls.find((x) => x[0] === 'insert')[1]
  assert.equal(ins.rider_id, 'rid')
  assert.equal(ins.race_date, '2026-12-05')
  for (const k of ['created_by', 'updated_by', 'set_by_coach', 'id']) assert.ok(!(k in ins))
  assert.ok((await createRace(c, { riderId: 'rid', day: '2026-12-05', name: '' })).error)
  assert.ok((await createRace(c, { riderId: 'rid', day: 'nope', name: 'x' })).error)
  const u = fakeClient({ data: null, error: null })
  assert.match((await updateRace(u, 'r1', { day: '2026-12-05', name: 'x' })).error.message, /not found/)
  const d = fakeClient({ data: [], error: null })
  assert.match((await deleteRace(d, 'r1')).error.message, /not found/)
  const d2 = fakeClient({ data: [{ id: 'r1' }], error: null })
  assert.equal((await deleteRace(d2, 'r1')).error, null)
})
