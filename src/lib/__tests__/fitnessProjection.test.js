// Run with: TZ=Europe/Prague node --test src/lib/__tests__/fitnessProjection.test.js
process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectFitness, partialForecastNote, plannedLoad, raceDayForm } from '../fitnessProjection.js'
import { computeSeries, addDays } from '../fitnessForm.js'

const today = '2027-03-01'
const daily = {}
for (let i = 60; i >= 0; i--) daily[addDays(today, -i)] = { load: 60, estimatedLoad: 0 }
const DSL = '2x\nwork 5min ±30% @ 90-110%FTP'
const ride = (day, extra = {}) => ({ id: day, workout_date: day, title: 'Ride', status: 'planned', structure_dsl: DSL, ...extra })

test('rest days continue from today with zero load', () => {
  const p = projectFitness(daily, { today, horizonDays: 14 })
  const base = computeSeries(daily, { endDay: today }).at(-1)
  assert.equal(p.series.length, 14)
  assert.equal(p.series[0].day, addDays(today, 1))
  assert.ok(Math.abs(p.series[0].form - (base.fitness - base.fatigue)) < 0.11)
  assert.ok(p.series[13].fatigue < base.fatigue)
  assert.ok(p.series[13].fitness < base.fitness)
  assert.equal(p.noEstimate, 0)
  assert.ok(p.series.every((s) => s.projected))
})

test('planned load matches computeSeries on the merged days', () => {
  const day = addDays(today, 1)
  const load = plannedLoad(ride(day))
  assert.ok(load > 0)
  const p = projectFitness(daily, { today, planned: [ride(day)], horizonDays: 14 })
  const ref = computeSeries({ ...daily, [day]: { load } }, { endDay: addDays(today, 14), startDay: day })
  assert.deepEqual(p.series.map((s) => s.fitness), ref.map((s) => s.fitness))
  assert.equal(p.series[0].workouts[0].load, load)
  assert.equal(p.planned, 1)
})

test('skipped, linked, past, today and out-of-horizon workouts add nothing', () => {
  const p = projectFitness(daily, {
    today,
    horizonDays: 14,
    planned: [
      ride(addDays(today, 2), { status: 'skipped' }),
      ride(addDays(today, 3), { activity_id: 'a' }),
      ride(today),
      ride(addDays(today, -2)),
      ride(addDays(today, 30)),
    ],
  })
  assert.equal(p.planned, 0)
  assert.ok(p.series.every((s) => s.plannedLoad === 0))
})

test('workouts without a load estimate count as zero and are reported', () => {
  const gym = { id: 'g', workout_date: addDays(today, 2), title: 'Gym', discipline: 'gym', status: 'planned' }
  const p = projectFitness(daily, { today, planned: [gym, ride(addDays(today, 3))], horizonDays: 14 })
  assert.equal(p.noEstimate, 1)
  assert.equal(p.planned, 2)
  assert.equal(p.series[1].workouts[0].load, null)
  assert.equal(p.series[1].plannedLoad, 0)
  assert.match(partialForecastNote(1), /1 planned workout has no load estimate/)
  assert.match(partialForecastNote(3), /3 planned workouts have/)
  assert.equal(partialForecastNote(0), '')
})

test('race day gives projected form and status', () => {
  const race = { id: 'r', name: 'Nationals', race_date: addDays(today, 10) }
  const p = projectFitness(daily, { today, races: [race, { id: 'x', race_date: addDays(today, 40) }], horizonDays: 14 })
  assert.equal(p.raceForms.length, 1)
  const f = p.raceForms[0]
  assert.equal(f.daysAway, 10)
  assert.equal(f.form, p.series[9].form)
  assert.ok(['fresh', 'detraining'].includes(f.status.key))
  assert.equal(raceDayForm(daily, race, { today }).form, f.form)
  assert.equal(raceDayForm(daily, { race_date: addDays(today, 90) }, { today }), null)
  assert.equal(raceDayForm(daily, { race_date: today }, { today }), null)
})

test('no history is empty; horizon is clamped to 2-8 weeks', () => {
  assert.equal(projectFitness({}, { today }).empty, true)
  assert.equal(projectFitness(daily, { today, horizonDays: 500 }).series.length, 56)
  assert.equal(projectFitness(daily, { today, horizonDays: 1 }).series.length, 14)
})

test('projectFitness: LT1 / zone workouts are no longer counted as having no estimate with rider context', () => {
  const planned = [{ id: 'a', workout_date: '2026-03-03', title: 'Endurance with LT1 intervals', structure_dsl: 'warmup 20min\n4x\nwork 10min @ 95-100%LT1\nrecovery 15min @ Z2\ncooldown 15min' }]
  const daily = { '2026-03-01': { load: 50, estimatedLoad: 0 } }
  const loadContext = { ftpHistory: [{ effective_from: '2026-01-01', ftp_w: 271 }], ltHistory: [], zoneHistory: [] }
  assert.equal(projectFitness(daily, { today: '2026-03-02', planned }).noEstimate, 1)
  const p = projectFitness(daily, { today: '2026-03-02', planned, loadContext })
  assert.equal(p.noEstimate, 0)
  assert.ok(plannedLoad(planned[0], loadContext) > 0)
})
