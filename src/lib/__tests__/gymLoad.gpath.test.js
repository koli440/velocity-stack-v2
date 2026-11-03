import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeGymLoad } from '../gymLoad.js'

// Real GPath session (owner, 2026-11-03): no history, so rep-implied intensity only.
const fx = JSON.parse(readFileSync(new URL('./fixtures/gpath-2026-11-03.json', import.meta.url), 'utf8'))

test('GPath session: no history, no HR reference, no generic velocity table', () => {
  const r = computeGymLoad({ exercises: fx.exercises, durationS: fx.durationS, avgHr: fx.avgHr })
  const by = Object.fromEntries(r.breakdown.map((b) => [b.name, b]))
  assert.equal(r.breakdown.length, 4)
  assert.equal(by['Box jump'].source, 'dynamic')
  assert.ok(r.flags.includes('dynamic_with_weight:Box jump'))
  for (const n of ['Box squat', 'Barbell Lunges', 'Legpress']) assert.equal(by[n].source, 'reps')
  assert.ok(r.flags.includes('assumed_unilateral:Barbell Lunges'))
  assert.ok(!r.flags.some((f) => f.startsWith('high_rep_floor')))
  assert.ok(r.flags.includes('hr_skipped_no_reference'))
  assert.equal(r.inputsUsed.hrMultiplier, 1)
  assert.ok(r.flags.includes('velocity_loss_high:Legpress'))
  assert.ok(r.load > 10 && r.load < 60, `load ${r.load}`)
})
