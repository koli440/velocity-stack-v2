import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_LACTATE_PLAN, LACTATE_INSTRUCTION, normalizeStepMinutes, planToRows } from '../lactatePlan.js'

test('fixed instruction and default steps', () => {
  assert.ok(LACTATE_INSTRUCTION.length > 50)
  assert.ok(DEFAULT_LACTATE_PLAN.steps.length >= 3)
  assert.equal(DEFAULT_LACTATE_PLAN.instruction, undefined)
})

test('normalizeStepMinutes accepts whole minutes 1-20', () => {
  assert.equal(normalizeStepMinutes('5').minutes, 5)
  for (const bad of [0, 21, 2.5, '', 'x']) assert.ok(normalizeStepMinutes(bad).error)
})

test('planToRows prefills watts from FTP', () => {
  const rows = planToRows({ steps: [{ pct: 50 }, { pct: 100 }] }, 250)
  assert.deepEqual(rows.map((r) => r.power), ['125', '250'])
  assert.deepEqual(planToRows({ steps: [{ pct: 50 }] }, null)[0].power, '')
})

test('lactate page has one step definition: no template editor, no stored plan, fixed instruction', () => {
  const src = readFileSync(new URL('../../components/LabLactateTest.js', import.meta.url), 'utf8')
  assert.ok(!/lab_lactate_plan|Save steps|Edit steps|textarea/.test(src))
  assert.match(src, /LACTATE_INSTRUCTION/)
  assert.match(src, /New step test/)
  assert.match(src, /Remove step/)
})
