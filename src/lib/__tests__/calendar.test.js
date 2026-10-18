import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMonthGrid,
  buildCalendarRows,
  shiftMonth,
  monthRange,
  activityToEvent,
  groupEventsByDay,
  summarizeEvents,
  formatDuration,
  fetchActivitiesInRange,
  dayKey,
} from '../calendar.js'

test('month grid is full Monday-start weeks covering the month', () => {
  const weeks = buildMonthGrid(new Date(2026, 9, 17)) // Oct 2026
  assert.equal(weeks[0][0].getDay(), 1)
  assert.equal(dayKey(weeks[0][0]), '2026-09-28')
  assert.equal(dayKey(weeks[weeks.length - 1][6]), '2026-11-01')
  assert.equal(weeks.length, 5)
  assert.ok(weeks.every((w) => w.length === 7))
})

test('monthRange is half-open and shiftMonth moves by month', () => {
  const r = monthRange(new Date(2026, 9, 14))
  assert.equal(dayKey(r.start), '2026-09-28')
  assert.equal(dayKey(r.end), '2026-11-02')
  assert.equal(dayKey(shiftMonth(new Date(2026, 0, 31), 1)), '2026-02-01')
  assert.equal(dayKey(shiftMonth(new Date(2026, 0, 31), -1)), '2025-12-01')
})

test('activityToEvent maps fields and picks a key metric', () => {
  const e = activityToEvent({ id: 'a', title: 'Ride', activity_date: '2026-10-14T08:00:00Z', distance_m: '30000.5', moving_time_s: 3600, avg_power_w: 210.4 })
  assert.equal(e.kind, 'activity')
  assert.equal(e.href, '/activities/a')
  assert.equal(e.metric.value, '210 W')
  assert.equal(e.discipline, 'ride')
  assert.equal(activityToEvent({ id: 'b', activity_date: 'x' }), null)
  assert.equal(activityToEvent({ id: 'c', activity_date: '2026-10-14T08:00:00Z', track_id: 't' }).discipline, 'track')
  assert.equal(activityToEvent({ id: 'c', activity_date: '2026-10-14T08:00:00Z' }).metric, null)
})

test('rows hold per-day events and weekly summaries', () => {
  const ev = [
    { id: '1', kind: 'activity', date: new Date(2026, 9, 13, 18), durationS: 3600, distanceM: 20000 },
    { id: '2', kind: 'activity', date: new Date(2026, 9, 13, 7), durationS: 1800, distanceM: 10000 },
    { id: '3', kind: 'activity', date: new Date(2026, 9, 20, 7), durationS: 600, distanceM: 1000 },
  ]
  const weeks = buildMonthGrid(new Date(2026, 9, 1))
  const rows = buildCalendarRows(weeks, ev, { anchor: new Date(2026, 9, 1), today: new Date(2026, 9, 14) })
  const wk = rows.find((r) => r.cells.some((c) => c.key === '2026-10-13'))
  assert.deepEqual(wk.summary, { count: 2, durationS: 5400, distanceM: 30000, plannedCount: 0, plannedDurationS: 0, races: [] })
  const tue = wk.cells.find((c) => c.key === '2026-10-13')
  assert.deepEqual(tue.events.map((e) => e.id), ['2', '1'])
  assert.equal(wk.cells.find((c) => c.key === '2026-10-14').isToday, true)
  assert.equal(rows[0].cells[0].inMonth, false)
  assert.equal(groupEventsByDay([null]).length, undefined)
  assert.equal(summarizeEvents([]).count, 0)
  assert.equal(formatDuration(5400), '1:30')
})

test('fetchActivitiesInRange queries only the range and needed columns', async () => {
  const calls = []
  const q = {
    select(c) { calls.push(['select', c]); return q },
    eq(...a) { calls.push(['eq', ...a]); return q },
    gte(...a) { calls.push(['gte', ...a]); return q },
    lt(...a) { calls.push(['lt', ...a]); return q },
    order() { return q },
    then(res) { res({ data: [{ id: 'a', activity_date: '2026-10-14T08:00:00Z' }], error: null }) },
  }
  const client = { from: (t) => { calls.push(['from', t]); return q } }
  const { data } = await fetchActivitiesInRange(client, { riderId: 'u1', startISO: 's', endISO: 'e' })
  assert.equal(data.length, 1)
  assert.deepEqual(calls.find((c) => c[0] === 'gte'), ['gte', 'activity_date', 's'])
  assert.deepEqual(calls.find((c) => c[0] === 'lt'), ['lt', 'activity_date', 'e'])
  assert.deepEqual(calls.find((c) => c[0] === 'eq'), ['eq', 'user_id', 'u1'])
  assert.ok(!calls.find((c) => c[0] === 'select')[1].includes('time_series'))
  assert.deepEqual(await fetchActivitiesInRange(client, {}), { data: [], error: null })
})

test('summarizeEvents keeps planned workouts out of the activity totals', () => {
  const s = summarizeEvents([
    { kind: 'activity', durationS: 3600, distanceM: 30000 },
    { kind: 'planned', durationS: 1800, distanceM: 0 },
  ])
  assert.deepEqual(s, { count: 1, durationS: 3600, distanceM: 30000, plannedCount: 1, plannedDurationS: 1800 })
})
