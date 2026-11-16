import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFieldData, fieldDeltas, sprintSpeedKmh, summarizeField } from '../labFieldForms.js'

test('body form validates ranges, accepts decimal commas and notes', () => {
  assert.deepEqual(buildFieldData('body', { weight_kg: '70,5', body_fat_pct: '12' }, ' ok ').data, { weight_kg: 70.5, body_fat_pct: 12, notes: 'ok' })
  assert.match(buildFieldData('body', { weight_kg: '5' }).error, /Weight/)
  assert.ok(buildFieldData('body', {}).error)
  assert.ok(buildFieldData('body', { weight_kg: '70' }, 'x'.repeat(501)).error)
})

test('sprint needs distance and time', () => {
  assert.ok(buildFieldData('sprint', { distance_m: '200' }).error)
  assert.equal(buildFieldData('sprint', { distance_m: '200', time_s: '15.2' }).data.time_s, 15.2)
  assert.equal(sprintSpeedKmh({ distance_m: 200, time_s: 18 }), 40)
  assert.equal(sprintSpeedKmh({}), null)
})

test('mobility keeps only pass/limited marks', () => {
  assert.deepEqual(buildFieldData('mobility', { hip_flexion: 'pass', hip_extension: 'bad', x: 'pass' }).data, { hip_flexion: 'pass' })
  assert.ok(buildFieldData('mobility', {}).error)
  assert.ok(buildFieldData('other', {}).error)
})

test('deltas compare the newest two results of a kind', () => {
  const rows = [
    { kind: 'body', data: { weight_kg: 70, body_fat_pct: 11.5, notes: 'a' } },
    { kind: 'sprint', data: { distance_m: 1, time_s: 1 } },
    { kind: 'body', data: { weight_kg: 71.2, body_fat_pct: 12 } },
  ]
  assert.deepEqual(fieldDeltas('body', rows), { weight_kg: -1.2, body_fat_pct: -0.5 })
  assert.deepEqual(fieldDeltas('sprint', rows), {})
  assert.deepEqual(fieldDeltas('mobility', [
    { kind: 'mobility', data: { hip_flexion: 'pass' } }, { kind: 'mobility', data: { hip_flexion: 'limited' } },
  ]), { hip_flexion: 'improved' })
})

test('summaries', () => {
  assert.equal(summarizeField('mobility', { hip_flexion: 'pass', hip_extension: 'limited' }), '1/2 pass')
  assert.match(summarizeField('sprint', { distance_m: 200, time_s: 18, peak_power_w: 1500 }), /\(40 km\/h\) · peak 1500 W/)
})
