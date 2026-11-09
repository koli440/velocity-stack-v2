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
  lapDeltas,
  chartScale,
  barShare,
  weightedFirstLap,
  FIRST_LAP_HALF_LIFE_MONTHS,
  MAX_FIRST_LAP_SHARE,
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

test('lapDeltas gives change vs previous lap, null for lap 1', () => {
  const d = lapDeltas([20, 18, 18.5, 19])
  assert.equal(d[0], null)
  assert.ok(Math.abs(d[1] + 2) < 1e-9)
  assert.ok(Math.abs(d[2] - 0.5) < 1e-9)
  assert.ok(Math.abs(d[3] - 0.5) < 1e-9)
  assert.deepEqual(lapDeltas([]), [])
})

const NOW = new Date('2026-11-09')
const rec = (first, date, extra = {}) => ({
  lap_times: [first, 19, 19, 19, 19],
  time_seconds: first + 76,
  achieved_date: date,
  ...extra,
})

test('weightedFirstLap weights newer records more (half weight per half-life)', () => {
  const r = weightedFirstLap([rec(24, '2026-11-09'), rec(21, '2025-11-09')], 5, { now: NOW })
  assert.equal(r.used, 2)
  assert.ok(r.seconds > 22.5 && r.seconds < 24)
  assert.ok(FIRST_LAP_HALF_LIFE_MONTHS === 12)
  const eq = weightedFirstLap([rec(24, '2026-11-09'), rec(21, '2026-11-09')], 5, { now: NOW })
  assert.ok(Math.abs(eq.seconds - 22.5) < 1e-9)
})

test('weightedFirstLap skips records with a different lap count or lap length', () => {
  const records = [
    rec(24, '2026-11-01'),
    { lap_times: [12, 10, 10, 10, 10, 10, 10, 10, 10, 10], time_seconds: 102, achieved_date: '2026-11-01' },
    rec(30, '2026-11-01', { split_distance_m: 333 }),
  ]
  const r = weightedFirstLap(records, 5, { trackLengthM: 250, now: NOW })
  assert.equal(r.used, 1)
  assert.ok(Math.abs(r.seconds - 24) < 1e-9)
  assert.equal(weightedFirstLap([records[1]], 5, { trackLengthM: 250, now: NOW }), null)
})

test('buildPacingCurve exposes firstLap and falls back to null when none match', () => {
  const ok = buildPacingCurve([rec(23, '2026-10-01')], 5, { now: NOW })
  assert.equal(ok.firstLap.used, 1)
  const none = buildPacingCurve([{ lap_times: [10, 9, 9, 10], time_seconds: 38 }], 8, { now: NOW })
  assert.equal(none.ok, true)
  assert.equal(none.firstLap, null)
})

test('applyPacingShape with a first lap keeps the total and the shape of laps 2..N', () => {
  const shape = [0.1, -0.05, -0.02, -0.03]
  const base = applyPacingShape(shape, 100)
  const laps = applyPacingShape(shape, 100, 30)
  assert.equal(laps[0], 30)
  assert.ok(Math.abs(sum(laps) - 100) < 1e-9)
  assert.ok(Math.abs(laps[1] / laps[2] - base[1] / base[2]) < 1e-9)
})

test('applyPacingShape clamps the first lap and ignores unusable values', () => {
  const shape = [0.1, -0.05, -0.02, -0.03]
  const hi = applyPacingShape(shape, 100, 90)
  assert.ok(Math.abs(hi[0] - 100 * MAX_FIRST_LAP_SHARE) < 1e-9)
  const lo = applyPacingShape(shape, 100, 5)
  assert.ok(Math.abs(lo[0] - 25) < 1e-9)
  assert.ok(Math.abs(sum(hi) - 100) < 1e-9 && Math.abs(sum(lo) - 100) < 1e-9)
  for (const bad of [null, undefined, NaN, 0, -3]) {
    assert.deepEqual(applyPacingShape(shape, 100, bad), applyPacingShape(shape, 100))
  }
})

test('chartScale uses laps 3..N and clips a dominant lap 2', () => {
  const d = [null, -5.45, 0.2, -0.1, 0.25]
  const { max, clipped } = chartScale([d, [null, -1, 0.1, 0, 0]])
  assert.equal(max, 0.25)
  assert.deepEqual(clipped, [false, true, false, false, false])
})

test('chartScale does not clip lap 2 when comparable, and handles short input', () => {
  assert.equal(chartScale([[null, -0.3, 0.2, 0.25]]).clipped[1], false)
  const two = chartScale([[null, -2]])
  assert.equal(two.max, 2)
  assert.equal(two.clipped[1], false)
  assert.equal(chartScale([[null, 0, 0]]).max, 0.01)
})

test('barShare gives tiny non-zero values a minimum and caps at 1', () => {
  assert.equal(barShare(0, 1), 0)
  assert.equal(barShare(0.001, 1), 0.04)
  assert.equal(barShare(-5, 1), 1)
  assert.equal(barShare(0.5, 1), 0.5)
})
