import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapCurvesToProfile, buildRadarData, hasProfileData, POWER_PROFILE_AXES } from '../powerProfile.js'

test('maps plain power curve to 7 axes, missing -> null', () => {
  const pts = mapCurvesToProfile({ '15s': 900, '1m': 600, '5m': 350, '1h': 250, '30s': 700 })
  assert.equal(pts.length, 7)
  assert.deepEqual(pts.map((p) => p.value), [900, 600, null, 350, null, null, 250])
})

test('accepts baseline curves object with { value } points', () => {
  const pts = mapCurvesToProfile({ Power: { '3m': { value: 400, activityId: 'a' } }, Speed: {} })
  assert.equal(pts[2].value, 400)
  assert.equal(pts[0].value, null)
})

test('W/kg conversion and missing weight', () => {
  assert.equal(mapCurvesToProfile({ '1m': 600 }, { perKg: true, weightKg: 75 })[1].value, 8)
  assert.equal(mapCurvesToProfile({ '1m': 600 }, { perKg: true })[1].value, null)
})

test('handles empty/invalid input', () => {
  assert.equal(hasProfileData(mapCurvesToProfile(null)), false)
  assert.equal(hasProfileData(mapCurvesToProfile({ '1m': 'x', '3m': 0 })), false)
})

test('buildRadarData merges series', () => {
  const d = buildRadarData({ a: mapCurvesToProfile({ '15s': 10 }), b: mapCurvesToProfile({ '15s': 20 }) })
  assert.equal(d.length, POWER_PROFILE_AXES.length)
  assert.deepEqual([d[0].a, d[0].b, d[1].a], [10, 20, null])
})
