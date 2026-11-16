import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ageFactor, scoreFromAnchors, bestsFromCurve, mergeBests, computeProfile, classifyPhenotype } from '../powerProfile.js'

test('ageFactor', () => {
  assert.equal(ageFactor(30), 1)
  assert.ok(Math.abs(ageFactor(55) - 0.84) < 1e-9)
  assert.equal(ageFactor(120), 0.7)
})

test('scoreFromAnchors interpolates and clamps', () => {
  const a = [2, 3, 4, 5, 6]
  assert.equal(scoreFromAnchors(1, a), 0)
  assert.equal(scoreFromAnchors(3.5, a), 37.5)
  assert.equal(scoreFromAnchors(9, a), 100)
})

test('bests from curves, numbers or objects, max over curves', () => {
  assert.deepEqual(bestsFromCurve({ '5s': 800, '1m': { value: 500 }, '5m': 'x' }), { '5s': 800, '1m': 500 })
  assert.deepEqual(mergeBests([{ '5s': 800 }, { '5s': 900, '20m': 300 }, null]), { '5s': 900, '20m': 300 })
})

test('profile needs weight and classifies a sprinter and a time trialist', () => {
  assert.ok(computeProfile({ bests: {}, weightKg: 0 }).error)
  const sprinter = computeProfile({ bests: { '5s': 1500, '1m': 700, '5m': 330, '20m': 270 }, weightKg: 75 })
  assert.equal(sprinter.phenotype.type, 'sprinter')
  const tt = computeProfile({ bests: { '5s': 900, '1m': 500, '5m': 400, '20m': 340 }, weightKg: 70 })
  assert.equal(tt.phenotype.type, 'time_trialist')
})

test('sex and age adjust the score; missing duration gives no phenotype', () => {
  const b = { '5s': 1000, '1m': 500, '5m': 330, '20m': 280 }
  const m = computeProfile({ bests: b, weightKg: 70, sex: 'male' })
  const f = computeProfile({ bests: b, weightKg: 70, sex: 'female' })
  const old = computeProfile({ bests: b, weightKg: 70, age: 55 })
  assert.ok(f.rows[2].score > m.rows[2].score)
  assert.ok(old.rows[2].score > m.rows[2].score)
  assert.equal(classifyPhenotype({ '5s': 50, '1m': 50, '5m': null, '20m': 50 }), null)
  assert.equal(classifyPhenotype({ '5s': 50, '1m': 52, '5m': 50, '20m': 51 }).type, 'all_rounder')
})
