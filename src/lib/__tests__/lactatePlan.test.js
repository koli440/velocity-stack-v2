import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_LACTATE_PLAN, LACTATE_INSTRUCTION, normalizePlan, planToRows, resolvePlan } from '../lactatePlan.js'

test('fixed instruction exists and the default plan has at least 3 valid steps', () => {
  assert.ok(LACTATE_INSTRUCTION.length > 50)
  assert.equal(DEFAULT_LACTATE_PLAN.instruction, undefined)
  assert.ok(normalizePlan(DEFAULT_LACTATE_PLAN).plan)
})

test('normalizePlan validates and drops blank steps', () => {
  const ok = normalizePlan({ instruction: 'ignored', step_minutes: '5', steps: [{ pct: '60' }, { pct: '' }, { pct: 70.4 }, { pct: 80 }] })
  assert.deepEqual(ok.plan, { step_minutes: 5, steps: [{ pct: 60 }, { pct: 70 }, { pct: 80 }] })
  assert.ok(normalizePlan({ step_minutes: 0, steps: [{ pct: 60 }, { pct: 70 }, { pct: 80 }] }).error)
  assert.ok(normalizePlan({ step_minutes: 4, steps: [{ pct: 60 }, { pct: 70 }] }).error)
  assert.ok(normalizePlan({ step_minutes: 4, steps: [{ pct: 5 }, { pct: 70 }, { pct: 80 }] }).error)
  assert.ok(normalizePlan({ step_minutes: 4, steps: Array(21).fill({ pct: 70 }) }).error)
})

test('resolvePlan falls back to defaults and respects ownership', () => {
  assert.equal(resolvePlan(null).plan, DEFAULT_LACTATE_PLAN)
  assert.equal(resolvePlan({ custom: false, editable: true }).plan, DEFAULT_LACTATE_PLAN)
  const r = resolvePlan({ custom: true, from_coach: true, editable: false, instruction: 'Hacked', step_minutes: 3, steps: [{ pct: 50 }] })
  assert.deepEqual([r.fromCoach, r.editable, r.plan.step_minutes], [true, false, 3])
  assert.equal(r.plan.instruction, undefined)
})

test('planToRows prefills watts from FTP', () => {
  const rows = planToRows({ steps: [{ pct: 50 }, { pct: 100 }] }, 250)
  assert.deepEqual(rows.map((r) => r.power), ['125', '250'])
  assert.deepEqual(planToRows({ steps: [{ pct: 50 }] }, null)[0].power, '')
})

test('no editor for the instruction text remains in the lactate component', () => {
  const src = readFileSync(new URL('../../components/LabLactateTest.js', import.meta.url), 'utf8')
  assert.ok(!/aria-label="Instruction"/.test(src) && !/editing\.instruction/.test(src) && !/<textarea[^>]*nstruction/.test(src))
  assert.match(src, /LACTATE_INSTRUCTION/)
})
