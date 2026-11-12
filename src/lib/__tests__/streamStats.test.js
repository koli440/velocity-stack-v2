// Run with: node --test src/lib/__tests__/streamStats.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStreamSeries } from '../activityStreams.js'
import { normalizedPower } from '../summaryMetrics.js'
import { computeStreamStats, sampleRange } from '../streamStats.js'

const rep = (v, n) => new Array(n).fill(v)

test('averages over the zoomed range only', () => {
  const pts = buildStreamSeries({ watts: [...rep(100, 60), ...rep(300, 60)], heartrate: [...rep(120, 60), ...rep(160, 60)] })
  const s = computeStreamStats(pts, [60, 119])
  assert.equal(s.avgPower, 300)
  assert.equal(s.avgHr, 160)
  assert.equal(s.maxPower, 300)
  assert.equal(s.durationS, 60)
  assert.equal(computeStreamStats(pts).avgPower, 200)
})

test('NP matches the summary algorithm and is null under 30 s', () => {
  const watts = [...rep(100, 40), ...rep(400, 40)]
  const pts = buildStreamSeries({ watts })
  assert.equal(computeStreamStats(pts).np, normalizedPower(watts))
  assert.equal(computeStreamStats(pts, [0, 28]).np, null)
  assert.ok(computeStreamStats(pts, [0, 29]).np > 0)
})

test('NP of a constant series equals that power; VI and IF', () => {
  const pts = buildStreamSeries({ watts: rep(250, 60) })
  const s = computeStreamStats(pts, null, { ftp: 250 })
  assert.ok(Math.abs(s.np - 250) < 1e-9)
  assert.ok(Math.abs(s.vi - 1) < 1e-9)
  assert.ok(Math.abs(s.intensityFactor - 1) < 1e-9)
  assert.equal(computeStreamStats(pts).intensityFactor, null)
})

test('missing samples are skipped in averages, zeros count; absent streams are null', () => {
  const pts = buildStreamSeries({ watts: [0, 200, null, 200], cadence: [90, null, 90, 90] })
  const s = computeStreamStats(pts)
  assert.equal(s.avgPower, (0 + 200 + 200) / 3)
  assert.equal(s.avgCadence, 90)
  assert.equal(s.avgHr, null)
  assert.equal(s.avgTorque, null)
  assert.equal(computeStreamStats(buildStreamSeries({ speed: [10, 10] })).hasPower, false)
})

test('distance: speed integrates to metres', () => {
  const pts = buildStreamSeries({ speed: rep(36, 10) })
  const s = computeStreamStats(pts)
  assert.ok(Math.abs(s.distanceM - 100) < 1e-9)
  assert.equal(s.avgSpeed, 36)
})

test('distance-mode range selects the same samples as the equivalent time range', () => {
  const series = { watts: Array.from({ length: 120 }, (_, i) => 100 + i), speed: rep(36, 120) } // 10 m/s
  const time = buildStreamSeries(series, 'time')
  const dist = buildStreamSeries(series, 'distance')
  assert.deepEqual(sampleRange(time, [20, 79]), [20, 79])
  assert.deepEqual(sampleRange(dist, [200, 790]), [20, 79])
  assert.equal(computeStreamStats(dist, [200, 790]).avgPower, computeStreamStats(time, [20, 79]).avgPower)
  assert.equal(computeStreamStats(dist, [200, 790]).np, computeStreamStats(time, [20, 79]).np)
})

test('stationary stretches (repeated distance) and out-of-range', () => {
  const dist = buildStreamSeries({ speed: [36, 36, 0, 0, 0, 36], watts: [1, 2, 3, 4, 5, 6] }, 'distance')
  assert.deepEqual(sampleRange(dist, [20, 20]), [2, 5])
  assert.equal(sampleRange(dist, [1e6, 2e6]), null)
  assert.equal(computeStreamStats([], null), null)
})
