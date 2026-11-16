import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSteps, oblaAt, dmax, computeLactateResult, ltEntryFromResult } from '../lactateStepTest.js'
import { validateLtEntry } from '../lactateThresholds.js'

const curve = [
  [100, 1.0, 110], [140, 1.1, 120], [180, 1.3, 130], [220, 1.8, 145],
  [260, 2.8, 158], [300, 4.5, 170], [340, 7.5, 180],
].map(([power, lactate, hr]) => ({ power, lactate, hr }))

test('normalizeSteps validates and sorts', () => {
  assert.ok(normalizeSteps([{ power: 100, lactate: 1 }]).error)
  assert.ok(normalizeSteps([{ power: 100, lactate: 1 }, { power: 100, lactate: 2 }, { power: 200, lactate: 3 }]).error)
  assert.ok(normalizeSteps([{ power: 0, lactate: 1 }, { power: 1, lactate: 1 }, { power: 2, lactate: 1 }]).error)
  const r = normalizeSteps([{ power: '200', lactate: '2' }, { power: 100, lactate: 1, hr: 100 }, { power: 150, lactate: 1.2 }, {}])
  assert.deepEqual(r.steps.map((s) => s.power), [100, 150, 200])
})

test('OBLA interpolates power and HR', () => {
  const o4 = oblaAt(curve, 4)
  assert.ok(Math.abs(o4.power - (260 + (40 * 1.2) / 1.7)) < 1e-9)
  assert.ok(o4.hr > 158 && o4.hr < 170)
  assert.equal(oblaAt(curve, 20), null)
  assert.equal(oblaAt(curve, 0.5), null)
})

test('Dmax lies between OBLA2 and the end and results build a valid LT entry', () => {
  const d = dmax(curve)
  assert.ok(d.power > 200 && d.power < 340)
  const res = computeLactateResult(curve)
  assert.ok(res.lt1.power < res.lt2.power)
  assert.equal(res.lt2Method, 'dmax')
  const entry = ltEntryFromResult(res, '2026-11-16')
  assert.ok(validateLtEntry(entry).entry)
})

test('Dmax needs 4 steps; falls back to OBLA 4', () => {
  const three = curve.slice(3, 6)
  assert.equal(dmax(three), null)
  assert.equal(computeLactateResult(three).lt2Method, 'obla4')
})

test('flat curve yields nothing', () => {
  const flat = [100, 150, 200, 250].map((power) => ({ power, lactate: 1, hr: null }))
  const r = computeLactateResult(flat)
  assert.equal(r.lt1, null)
  assert.equal(ltEntryFromResult(r, '2026-11-16'), null)
})
