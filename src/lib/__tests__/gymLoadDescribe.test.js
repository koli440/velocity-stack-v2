import test from 'node:test'
import assert from 'node:assert/strict'
import { describeGymFlag, describeGymFlags, describeBreakdownRow, describeGymInputs } from '../gymLoadDescribe.js'

test('flags read as plain language', () => {
  assert.match(describeGymFlag('dynamic_with_weight:Box jump'), /weight ignored for jumps/)
  assert.match(describeGymFlag('assumed_unilateral:Lunges'), /both legs/)
  assert.match(describeGymFlag('hr_skipped_no_reference'), /Heart rate not used/)
  assert.equal(describeGymFlag('unknown_flag:x'), null)
  assert.equal(describeGymFlags(['no_working_sets', 'no_working_sets', 'zzz']).length, 1)
})

test('breakdown row and inputs', () => {
  const d = describeBreakdownRow({ name: 'Squat', workingSets: 1, intensity: 0.756, source: 'history', stress: 4.26 })
  assert.equal(d.sets, '1 working set')
  assert.equal(d.intensity, '76% of max')
  assert.match(d.source, /earlier sessions/)
  assert.deepEqual(describeGymInputs({ density: { setsPerMin: 0.5, multiplier: 0.9 }, inputsUsed: { hrMultiplier: 1 } }).length, 1)
})
