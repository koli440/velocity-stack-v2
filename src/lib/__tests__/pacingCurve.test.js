import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  usableLapTimes,
  relativeProfile,
  resampleProfile,
  smoothProfile,
  buildPacingCurve,
  applyPacingShape,
  fallbackMessage,
  FALLBACK_REASONS,
} from '../pacingCurve.js'

const sum = (a) => a.reduce((x, y) => x + y, 0)

test('usableLapTimes rejects missing, short, invalid and partial splits', () => {
  assert.equal(usableLapTimes({ lap_times: [] }), null)
  assert.equal(usableLapTimes({ lap_times: [20] }), null)
  assert.equal(usableLapTimes({ lap_times: [20, 0, 20] }), null)
  assert.equal(usableLapTimes({ lap_times: [20, 20], time_seconds: 100 }), null)
  assert.deepEqual(usableLapTimes({ lap_times: ['20', '21'], time_seconds: '41' }), [20, 21])
  assert.deepEqual(usableLapTimes({ lap_times: [20, 21] }), [20, 21])
})

test('relativeProfile is relative to the effort average', () => {
  const p = relativeProfile([9, 10, 11])
  assert.ok(Math.abs(p[0] + 0.1) < 1e-9 && Math.abs(p[2] - 0.1) < 1e-9)
})

test('resampleProfile keeps length or interpolates', () => {
  assert.deepEqual(resampleProfile([1, 2, 3], 3), [1, 2, 3])
  const r = resampleProfile([0, 1], 4)
  assert.equal(r.length, 4)
  assert.ok(r[0] <= r[1] && r[1] <= r[2] && r[2] <= r[3])
})

test('smoothProfile keeps first and last lap', () => {
  const s = smoothProfile([0, 4, 0, 0])
  assert.equal(s[0], 0)
  assert.equal(s[3], 0)
  assert.equal(s[1], 2)
})

test('buildPacingCurve reports no records / no lap data', () => {
  assert.deepEqual(buildPacingCurve([], 4), {
    ok: false,
    reason: FALLBACK_REASONS.NO_RECORDS,
    recordsUsed: 0,
    recordsTotal: 0,
  })
  const r = buildPacingCurve([{ lap_times: [], time_seconds: 90 }], 4)
  assert.equal(r.ok, false)
  assert.equal(r.reason, FALLBACK_REASONS.NO_LAPS)
  assert.equal(r.recordsTotal, 1)
})

test('buildPacingCurve uses median across records and skips records without laps', () => {
  const fast = [20, 19, 19, 19, 20]
  const records = [
    { lap_times: fast, time_seconds: 97 },
    { lap_times: [21, 19, 19, 19, 21], time_seconds: 99 },
    { lap_times: [20, 19.5, 19, 19.5, 20], time_seconds: 98 },
    { lap_times: [], time_seconds: 100 },
  ]
  const r = buildPacingCurve(records, 5)
  assert.equal(r.ok, true)
  assert.equal(r.recordsUsed, 3)
  assert.equal(r.recordsTotal, 4)
  assert.equal(r.shape.length, 5)
  assert.ok(Math.abs(sum(r.shape)) < 1e-9)
  assert.ok(r.shape[0] > 0 && r.shape[2] < 0)
})

test('buildPacingCurve resamples records with a different lap count', () => {
  const r = buildPacingCurve([{ lap_times: [10, 9, 9, 10], time_seconds: 38 }], 8)
  assert.equal(r.ok, true)
  assert.equal(r.shape.length, 8)
})

test('applyPacingShape preserves the target total', () => {
  const laps = applyPacingShape([0.05, -0.02, -0.03], 210)
  assert.ok(Math.abs(sum(laps) - 210) < 1e-9)
  assert.ok(laps[0] > laps[1])
})

test('fallbackMessage mentions the reason', () => {
  assert.match(fallbackMessage(FALLBACK_REASONS.NO_RECORDS, { disciplineName: 'X', distanceM: 3000 }), /No PB Vault records/)
  assert.match(fallbackMessage(FALLBACK_REASONS.NO_LAPS, { disciplineName: 'X', distanceM: 3000 }), /no usable lap splits/)
})
