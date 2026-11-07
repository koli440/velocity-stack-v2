// Run with: TZ=Europe/Prague node --test src/lib/__tests__/calendarLoad.test.js
process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayLoad, weekLoad, activityTlLabel, completedEventLoad, addLoadToRows, unscoredReason } from '../calendarLoad.js'
import { activityToEvent, buildCalendarRows, buildMonthGrid } from '../calendar.js'
import { plannedToEvent } from '../plannedWorkouts.js'

const TODAY = '2027-03-10'
const act = (id, day, extra = {}) => activityToEvent({ id, activity_date: `${day}T09:00:00`, moving_time_s: 3600, training_load: 85, ...extra })
const plan = (id, day, load, extra = {}) => ({ kind: 'planned', id, status: 'planned', load, activityId: null, ...extra, date: new Date(`${day}T00:00:00`) })

test('completed day counts only completed activities, never the linked plan', () => {
  const events = [act('a', '2027-03-08'), plan('p', '2027-03-08', 90, { status: 'completed', activityId: 'a' })]
  const d = dayLoad(events, '2027-03-08', TODAY)
  assert.equal(d.completed, 85)
  assert.equal(d.plannedRemaining, 0)
  assert.equal(d.mode, 'completed')
})

test('missed or skipped plan on a past day contributes 0', () => {
  const d = dayLoad([plan('p', '2027-03-08', 90, { status: 'missed' }), plan('s', '2027-03-08', 50, { status: 'skipped' })], '2027-03-08', TODAY)
  assert.deepEqual([d.completed, d.plannedRemaining, d.mode], [0, 0, 'none'])
})

test('future day shows the planned estimate; skipped and unestimated plans do not add', () => {
  const d = dayLoad([plan('p', '2027-03-12', 80), plan('s', '2027-03-12', 40, { status: 'skipped' }), plan('n', '2027-03-12', null)], '2027-03-12', TODAY)
  assert.deepEqual([d.completed, d.plannedRemaining, d.plannedRemainingUnknown, d.mode], [0, 80, 1, 'planned'])
})

test('today keeps completed and remaining plan separate', () => {
  const events = [act('a', TODAY, { training_load: 40 }), plan('done', TODAY, 45, { status: 'completed', activityId: 'a' }), plan('later', TODAY, 60)]
  const d = dayLoad(events, TODAY, TODAY)
  assert.deepEqual([d.completed, d.plannedRemaining, d.mode], [40, 60, 'mixed'])
})

test('HR estimates are flagged and labelled with ~', () => {
  const e = act('h', '2027-03-08', { training_load: null, avg_hr: 150, lt2_hr_at_activity: 170 })
  assert.equal(completedEventLoad(e).estimated, true)
  assert.match(activityTlLabel(e), /^TL ~\d+$/)
  assert.equal(activityTlLabel(act('a', '2027-03-08')), 'TL 85')
  assert.equal(activityTlLabel(act('u', '2027-03-08', { training_load: null })), null)
  const d = dayLoad([e], '2027-03-08', TODAY)
  assert.equal(d.completedEstimated, true)
})

test('gym: shown but not counted when excluded from fitness', () => {
  const g = act('g', '2027-03-08', { activity_type: 'gym', gym_load_model: 1, training_load: 30 })
  assert.equal(dayLoad([g], '2027-03-08', TODAY).completed, 30)
  const off = dayLoad([g], '2027-03-08', TODAY, { includeGym: false })
  assert.deepEqual([off.completed, off.excludedGym], [0, 30])
  assert.equal(activityTlLabel(g, { includeGym: false }), 'TL ~30')
  assert.equal(completedEventLoad(g, { includeGym: false }).excluded, true)
})

test('week: planned target includes linked workouts, completed sums done load', () => {
  const events = [
    act('a', '2027-03-08'),
    plan('p1', '2027-03-08', 90, { status: 'completed', activityId: 'a' }),
    plan('p2', '2027-03-09', 70, { status: 'missed' }),
    plan('p3', '2027-03-12', 50),
    plan('p4', '2027-03-13', 99, { status: 'skipped' }),
  ]
  const w = weekLoad(events)
  assert.deepEqual([w.completed, w.planned, w.plannedPartial, w.hasPlanned], [85, 210, false, true])
})

test('week: workout without estimate marks the planned total partial', () => {
  const w = weekLoad([plan('p1', '2027-03-12', 50), plan('p2', '2027-03-13', null)])
  assert.deepEqual([w.planned, w.plannedPartial], [50, true])
  assert.equal(weekLoad([act('a', '2027-03-08')]).hasPlanned, false)
})

test('plannedToEvent exposes the numeric load (none for runs)', () => {
  const dsl = '2x\nwork 5min ±30% @ 90-110%FTP'
  const w = { id: 'w', workout_date: '2027-03-12', title: 'R', status: 'planned', structure_dsl: dsl, discipline: 'ride' }
  const e = plannedToEvent(w, new Date(2027, 2, 10))
  assert.ok(e.load > 0)
  assert.equal(e.metric.value, `~TL ${e.load}`)
  assert.equal(plannedToEvent({ ...w, discipline: 'run' }, new Date(2027, 2, 10)).load, null)
})

test('addLoadToRows attaches day and week load', () => {
  const weeks = buildMonthGrid(new Date(2027, 2, 10))
  const rows = buildCalendarRows(weeks, [act('a', '2027-03-08'), plan('p', '2027-03-12', 70)], { anchor: new Date(2027, 2, 10), today: new Date(2027, 2, 10) })
  const withTl = addLoadToRows(rows, { today: new Date(2027, 2, 10) })
  const week = withTl.find((r) => r.cells.some((c) => c.key === '2027-03-08'))
  assert.equal(week.cells.find((c) => c.key === '2027-03-08').tl.completed, 85)
  assert.equal(week.cells.find((c) => c.key === '2027-03-12').tl.plannedRemaining, 70)
  assert.deepEqual([week.summary.tl.completed, week.summary.tl.planned], [85, 70])
})

test('day and week split measured / estimated (HR + gym) / unscored', () => {
  const events = [
    act('m', '2027-03-08', { training_load: 85 }),
    act('h', '2027-03-08', { training_load: null, avg_hr: 170, lt2_hr_at_activity: 170, activity_type: 'run' }),
    act('g', '2027-03-08', { activity_type: 'gym', gym_load_model: 1, training_load: 30 }),
    act('u', '2027-03-08', { training_load: null, activity_type: 'run' }),
  ]
  const d = dayLoad(events, '2027-03-08', TODAY)
  assert.deepEqual([d.completed, d.measured, d.estimated, d.unscored], [215, 85, 130, 1])
  const w = weekLoad(events)
  assert.deepEqual([w.completed, w.measured, w.estimated, w.unscored], [215, 85, 130, 1])
  const off = weekLoad(events, { includeGym: false })
  assert.deepEqual([off.completed, off.estimated, off.excludedGym], [185, 100, 30])
})

test('unscoredReason explains why a completed run/ride has no TL', () => {
  const run = (extra) => act('r', '2027-03-08', { training_load: null, activity_type: 'run', ...extra })
  assert.equal(unscoredReason(run({})), 'noHr')
  assert.equal(unscoredReason(run({ avg_hr: 150 })), 'noLt2')
  assert.equal(unscoredReason(run({ avg_hr: 150, moving_time_s: 60 })), 'tooShort')
  assert.equal(unscoredReason(run({ avg_hr: 150, lt2_hr_at_activity: 170 })), null)
  assert.equal(unscoredReason(act('s', '2027-03-08')), null)
  assert.equal(unscoredReason(act('g', '2027-03-08', { training_load: null, activity_type: 'gym' })), null)
})

import { overPlan, monthTotals } from '../calendarLoad.js'

test('overPlan: under plan, no over', () => {
  const o = overPlan(60, 100)
  assert.equal(o.over, false)
  assert.equal(o.label, null)
  assert.equal(o.fillPct, 60)
  assert.equal(o.tickPct, 100)
  assert.equal(o.overBarPct, 0)
})

test('overPlan: over plan adds an excess segment beyond the planned tick', () => {
  const o = overPlan(120, 100, { measured: 90 })
  assert.equal(o.over, true)
  assert.equal(o.excess, 20)
  assert.equal(o.overPct, 20)
  assert.equal(o.label, 'over plan')
  assert.equal(o.fillPct, 100)
  assert.ok(Math.abs(o.tickPct - (100 / 120) * 100) < 1e-9)
  assert.ok(Math.abs(o.measuredPct + o.estimatedPct + o.overBarPct - 100) < 1e-9)
  assert.ok(Math.abs(o.measuredPct - 75) < 1e-9)
})

test('overPlan: no or zero plan never reports over', () => {
  for (const p of [0, null, undefined, NaN]) {
    const o = overPlan(50, p)
    assert.equal(o.over, false)
    assert.equal(o.tickPct, null)
    assert.equal(o.fillPct, 0)
  }
})

test('overPlan: partial plan is "over known plan" without a percentage', () => {
  const o = overPlan(120, 100, { partial: true })
  assert.equal(o.over, true)
  assert.equal(o.overPct, null)
  assert.equal(o.partialPlan, true)
  assert.equal(o.label, 'over known plan')
})

test('monthTotals counts only days of the displayed month', () => {
  const anchor = new Date('2027-03-15T00:00:00')
  const events = [
    act('feb', '2027-02-28'), // grid day of the previous month
    act('m1', '2027-03-01'),
    act('m2', '2027-03-31', { distance_m: 10000 }),
    act('apr', '2027-04-01'),
    plan('p1', '2027-03-20', 70, { durationS: 3600 }),
    plan('p2', '2027-03-21', 50, { status: 'skipped' }),
    plan('pOut', '2027-04-02', 99),
  ]
  const rows = addLoadToRows(buildCalendarRows(buildMonthGrid(anchor), events, { anchor }), { today: new Date('2027-03-10T12:00:00') })
  const t = monthTotals(rows)
  assert.equal(t.count, 2)
  assert.equal(t.durationS, 7200)
  assert.equal(t.distanceM, 10000)
  assert.equal(t.byDiscipline.ride, 2)
  assert.equal(t.tl.completed, 170)
  assert.equal(t.tl.projected, 170 + 70)
  assert.equal(t.planned.count, 1)
  assert.equal(t.planned.load, 70)
  assert.equal(t.planned.durationS, 3600)
})

test('monthTotals: linked plan is not double counted in completed, past plan not done adds no completed', () => {
  const anchor = new Date('2027-03-15T00:00:00')
  const events = [act('a', '2027-03-08'), plan('p', '2027-03-08', 90, { status: 'completed', activityId: 'a' }), plan('missed', '2027-03-05', 60, { status: 'missed' })]
  const rows = addLoadToRows(buildCalendarRows(buildMonthGrid(anchor), events, { anchor }), { today: new Date('2027-03-10T12:00:00') })
  const t = monthTotals(rows)
  assert.equal(t.count, 1)
  assert.equal(t.tl.completed, 85)
  assert.equal(t.tl.projected, 85)
  assert.equal(t.planned.load, 150)
})
