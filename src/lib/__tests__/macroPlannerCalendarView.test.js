import test from 'node:test'
import assert from 'node:assert/strict'
import { phaseLabels, raceMarkers, weekGuidance, dayHint, weekProgress } from '../macroPlannerCalendarView.js'

const wk = (week_start, kind, extra = {}) => ({ week_start, kind, target_tl: 300, ...extra })

test('phase labels count runs of build weeks, recovery and taper', () => {
  const l = phaseLabels([wk('2027-01-04', 'build'), wk('2027-01-11', 'build'), wk('2027-01-18', 'build'), wk('2027-01-25', 'recovery'), wk('2027-02-01', 'build'), wk('2027-02-08', 'taper')])
  assert.equal(l.get('2027-01-04'), 'Build 1/3')
  assert.equal(l.get('2027-01-18'), 'Build 3/3')
  assert.equal(l.get('2027-01-25'), 'Recovery')
  assert.equal(l.get('2027-02-01'), 'Build 1/1')
  assert.equal(l.get('2027-02-08'), 'Taper 1/1')
})

test('race markers: A race plus B/C, missing races skipped', () => {
  const m = raceMarkers({ race_date: '2027-03-01', race_name: 'Nats', races: [{ race_date: '2027-02-01', priority: 'B', name: 'Club' }, { race_date: '2027-02-08', priority: 'C', name: 'Gone', missing: true }] })
  assert.deepEqual(m.get('2027-03-01'), [{ role: 'A', name: 'Nats' }])
  assert.deepEqual(m.get('2027-02-01'), [{ role: 'B', name: 'Club' }])
  assert.equal(m.has('2027-02-08'), false)
})

test('week guidance and day hints', () => {
  const g = weekGuidance({ weeks: [wk('2027-01-04', 'build', { focus: 'Base', day_shape: 'RHEHEHE' }), wk('2027-01-11', 'build', { day_shape: 'bad' })] })
  assert.equal(g.get('2027-01-04').focus, 'Base')
  assert.deepEqual(dayHint(g.get('2027-01-04'), 0), { code: 'R', label: 'Rest' })
  assert.equal(dayHint(g.get('2027-01-04'), 1).label, 'Hard')
  assert.equal(dayHint(g.get('2027-01-11'), 0), null)
  assert.equal(dayHint(undefined, 0), null)
})

test('week progress: remaining TL to schedule never goes negative', () => {
  const g = { target: 300 }
  assert.deepEqual(weekProgress(g, { completed: 100, plannedRemaining: 120 }), { target: 300, done: 100, scheduled: 120, toSchedule: 80 })
  assert.equal(weekProgress(g, { completed: 250, plannedRemaining: 120 }).toSchedule, 0)
  assert.equal(weekProgress({}, { completed: 1 }), null)
  assert.equal(weekProgress(g, null).toSchedule, 300)
})
