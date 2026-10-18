import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPowerPreview, powerPreviewSeries } from '../powerPreview.js'

test('downsamples 1 Hz watts into <= 80 rounded bucket averages', () => {
  const watts = Array.from({ length: 1000 }, (_, i) => 200 + (i % 3))
  const p = buildPowerPreview(watts)
  assert.equal(p.kind, 'power')
  assert.equal(p.step_s, 13)
  assert.ok(p.values.length <= 80 && p.values.length >= 70)
  assert.ok(p.values.every((v) => v >= 200 && v <= 202 && Number.isInteger(v)))
})

test('short series keep one point per second', () => {
  const p = buildPowerPreview([100, 110, 120, 130, 140, 150, 160, 170, 180, 190])
  assert.deepEqual([p.step_s, p.values.length], [1, 10])
})

test('no usable power yields the none sentinel', () => {
  for (const w of [null, undefined, [], [1, 2, 3], new Array(50).fill(0), new Array(50).fill(null)]) {
    assert.deepEqual(buildPowerPreview(w), { kind: 'none' })
  }
})

test('powerPreviewSeries maps values to elapsed time rows', () => {
  const rows = powerPreviewSeries({ kind: 'power', step_s: 30, values: [100, 200, 300] })
  assert.deepEqual(rows.map((r) => [r.t, r.label, r.power]), [[0, '0m', 100], [30, '1m', 200], [60, '1m', 300]])
  assert.equal(powerPreviewSeries({ kind: 'none' }), null)
  assert.equal(powerPreviewSeries(null), null)
})
