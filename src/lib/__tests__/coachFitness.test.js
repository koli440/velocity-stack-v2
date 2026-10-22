// Run with: TZ=Europe/Prague node --test src/lib/__tests__/coachFitness.test.js
process.env.TZ = 'Europe/Prague'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchCoachFitnessRows,
  groupFitnessRows,
  fitnessFlags,
  athleteFitnessSummary,
  summarizeAthletes,
  sortAthletes,
  COACH_DASHBOARD_DAYS,
} from '../coachFitness.js'
import { addDays } from '../fitnessForm.js'

const TODAY = '2026-10-20'
const row = (rider, daysAgo, load, extra = {}) => ({
  rider_id: rider,
  id: `${rider}-${daysAgo}`,
  activity_date: `${addDays(TODAY, -daysAgo)}T10:00:00`,
  training_load: load,
  first_activity_at: `${addDays(TODAY, -300)}T10:00:00`,
  ...extra,
})

test('groups rows per athlete and maps lthr to the snapshot field', () => {
  const g = groupFitnessRows([row('a', 1, 50, { lthr: 170 }), row('b', 2, 40), row('a', 3, 30)])
  assert.equal(g.get('a').rides.length, 2)
  assert.equal(g.get('a').rides[0].lt2_hr_at_activity, 170)
  assert.equal(g.get('b').rides.length, 1)
})

test('athlete summary uses stored load and HR estimate with the athlete threshold', () => {
  const g = groupFitnessRows([
    row('a', 1, null, { moving_time_s: 3600, avg_hr: 150, lthr: 150 }),
    row('a', 2, 60),
  ])
  const s = athleteFitnessSummary(g.get('a'), TODAY)
  assert.equal(s.empty, false)
  assert.ok(s.estimateShare > 0)
  assert.equal(athleteFitnessSummary(groupFitnessRows([row('a', 1, null, { moving_time_s: 3600, avg_hr: 150 })]).get('a'), TODAY).empty, true)
})

test('empty group gives the no-data flag', () => {
  const s = athleteFitnessSummary(undefined, TODAY)
  assert.equal(s.empty, true)
  assert.deepEqual(s.flags.map((f) => f.key), ['no-data'])
})

test('flags: very negative form, fast ramp, building baseline', () => {
  const rows = []
  for (let d = 0; d < 10; d++) rows.push(row('a', d, 300, { first_activity_at: `${addDays(TODAY, -10)}T10:00:00` }))
  const s = athleteFitnessSummary(groupFitnessRows(rows).get('a'), TODAY)
  const keys = s.flags.map((f) => f.key)
  assert.ok(keys.includes('very-tired'))
  assert.ok(keys.includes('ramp-fast'))
  assert.ok(keys.includes('building'))
  assert.equal(s.flags[0].level, 'alert')
})

test('steady athlete with long history has no flags', () => {
  const rows = []
  for (let d = 0; d < 200; d++) rows.push(row('a', d, 50))
  const s = athleteFitnessSummary(groupFitnessRows(rows).get('a'), TODAY)
  assert.deepEqual(s.flags, [])
})

test('fitnessFlags tolerates missing summary', () => {
  assert.equal(fitnessFlags(null)[0].key, 'no-data')
})

test('summarizeAthletes covers athletes without rows and drops the series', () => {
  const m = summarizeAthletes([row('a', 1, 50)], ['a', 'z'], TODAY)
  assert.equal(m.get('z').empty, true)
  assert.equal(m.get('a').series, undefined)
})

test('sortAthletes: form most tired first, missing last, name tiebreak, no mutation', () => {
  const mk = (name, fitness, lastActivityAt = null) => ({ name, fitness, lastActivityAt })
  const f = (form, fit = 50, ramp = 0) => ({ empty: false, form, fitness: fit, fatigue: fit - form, ramp, flags: [] })
  const items = [mk('Cy', null), mk('Bo', f(-5)), mk('Al', f(-20)), mk('Di', { empty: true, flags: [] })]
  const copy = [...items]
  assert.deepEqual(sortAthletes(items, 'form').map((a) => a.name), ['Al', 'Bo', 'Cy', 'Di'])
  assert.deepEqual(items, copy)
  assert.deepEqual(sortAthletes(items, 'name').map((a) => a.name), ['Al', 'Bo', 'Cy', 'Di'])
  assert.deepEqual(sortAthletes([mk('B', f(0, 40)), mk('A', f(0, 60))], 'fitness').map((a) => a.name), ['A', 'B'])
  assert.deepEqual(
    sortAthletes([mk('A', null, '2026-10-01'), mk('B', null, '2026-10-10'), mk('C', null)], 'activity').map((a) => a.name),
    ['B', 'A', 'C']
  )
  const tired = { ...f(-40), flags: [{ level: 'alert' }] }
  assert.equal(sortAthletes([mk('A', f(0)), mk('B', tired)], 'flags')[0].name, 'B')
})

test('fetchCoachFitnessRows pages past the cap and passes riders/days', async () => {
  const calls = []
  const client = {
    rpc: (fn, args) => ({
      range: async (from, to) => {
        calls.push({ fn, args, from, to })
        const total = 5
        const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({ id: from + i }))
        return { data, error: null }
      },
    }),
  }
  const { rows, error } = await fetchCoachFitnessRows(client, { riderIds: ['a'], pageSize: 2 })
  assert.equal(error, null)
  assert.equal(rows.length, 5)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args, { p_riders: ['a'], p_days: COACH_DASHBOARD_DAYS })
  assert.equal(calls[0].fn, 'coach_fitness_activities')
  assert.deepEqual((await fetchCoachFitnessRows(client, { riderIds: [] })).rows, [])
})

test('fetchCoachFitnessRows surfaces errors', async () => {
  const client = { rpc: () => ({ range: async () => ({ data: null, error: new Error('nope') }) }) }
  const r = await fetchCoachFitnessRows(client)
  assert.equal(r.error.message, 'nope')
  assert.deepEqual(r.rows, [])
})
