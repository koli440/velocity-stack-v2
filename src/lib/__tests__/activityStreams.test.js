// Run with: node --test src/lib/__tests__/activityStreams.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStreamSeries,
  formatElapsed,
  formatDistanceKm,
  formatAxisTick,
} from '../activityStreams.js'

test('buildStreamSeries returns [] when there is no stream data', () => {
  assert.deepEqual(buildStreamSeries({}, 'time'), [])
  assert.deepEqual(buildStreamSeries(null, 'time'), [])
  assert.deepEqual(buildStreamSeries({ watts: [] }, 'time'), [])
})

test('buildStreamSeries indexes by elapsed seconds in time mode', () => {
  const series = buildStreamSeries(
    { watts: [100, 200, 300], cadence: [80, 85, 90] },
    'time'
  )
  assert.equal(series.length, 3)
  assert.deepEqual(series.map((p) => p.x), [0, 1, 2])
  assert.deepEqual(series.map((p) => p.watts), [100, 200, 300])
  assert.deepEqual(series.map((p) => p.cadence), [80, 85, 90])
  // Metrics absent from the input stream are reported as null, not undefined.
  assert.equal(series[0].torque, null)
})

test('buildStreamSeries integrates cumulative distance from the speed stream', () => {
  // 36 km/h == 10 m/s, held for 3 samples -> 0m, 10m, 20m cumulative.
  const series = buildStreamSeries({ speed: [36, 36, 36] }, 'distance')
  assert.deepEqual(series.map((p) => p.x), [0, 10, 20])
})

test('buildStreamSeries keeps x flat in distance mode while stationary (issue #22)', () => {
  // Moving, then stopped for 3 samples (speed 0), then moving again.
  const series = buildStreamSeries({ speed: [36, 36, 0, 0, 0, 36] }, 'distance')
  // Distance must not advance while speed is 0 — repeated x values are expected so the
  // chart (rendered with a numeric X axis) collapses the stop instead of spreading it out
  // like it would on a time axis.
  assert.deepEqual(series.map((p) => p.x), [0, 10, 20, 20, 20, 20])
})

test('buildStreamSeries pads missing samples within the longest stream with null', () => {
  const series = buildStreamSeries({ watts: [100, 200, 300], heartrate: [140] }, 'time')
  assert.equal(series.length, 3)
  assert.equal(series[0].heartrate, 140)
  assert.equal(series[1].heartrate, null)
  assert.equal(series[2].heartrate, null)
})

test('formatElapsed formats seconds as mm:ss and h:mm:ss', () => {
  assert.equal(formatElapsed(5), '0:05')
  assert.equal(formatElapsed(65), '1:05')
  assert.equal(formatElapsed(3725), '1:02:05')
})

test('formatDistanceKm formats meters as km with two decimals', () => {
  assert.equal(formatDistanceKm(1234), '1.23 km')
  assert.equal(formatDistanceKm(null), '0.00 km')
})

test('formatAxisTick switches format based on mode', () => {
  assert.equal(formatAxisTick(65, 'time'), '1:05')
  assert.equal(formatAxisTick(1500, 'distance'), '1.5km')
})
