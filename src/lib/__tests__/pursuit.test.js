// src/lib/__tests__/pursuit.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WHEEL_CIRCUMFERENCE_M,
  DISCIPLINES,
  formatTime,
  getTrackLaps,
  pacingStrategyLabel,
  calculatePursuitStrategy,
} from '../pursuit.js'

test('formatTime renders M:SS.mmm like v1\'s format_time()', () => {
  assert.equal(formatTime(210), '3:30.000')
  assert.equal(formatTime(5), '0:05.000')
  assert.equal(formatTime(65.5), '1:05.500')
  assert.equal(formatTime(3723.125), '62:03.125')
})

test('getTrackLaps rounds distances that land within tolerance of a whole lap count', () => {
  // 4000m individual pursuit on a 250m track = exactly 16 laps.
  assert.deepEqual(getTrackLaps(250, 4000), { laps: 16, valid: true })
  // Slightly-off distances within the 0.05-lap tolerance still resolve.
  assert.deepEqual(getTrackLaps(250, 4001), { laps: 16, valid: true })
  assert.deepEqual(getTrackLaps(333.33, 1000), { laps: 3, valid: true })
})

test('getTrackLaps rejects distances that do not cleanly divide the track length', () => {
  // 4000m on a 300m track is 13.33 laps - nowhere near a whole number.
  const result = getTrackLaps(300, 4000)
  assert.equal(result.valid, false)
  assert.equal(result.laps, 0)
})

test('getTrackLaps handles invalid/zero inputs defensively', () => {
  assert.deepEqual(getTrackLaps(0, 4000), { laps: 0, valid: false })
  assert.deepEqual(getTrackLaps(250, 0), { laps: 0, valid: false })
})

test('pacingStrategyLabel classifies drift sign the same way v1\'s UI messaging does', () => {
  assert.equal(pacingStrategyLabel(-0.1), 'negative')
  assert.equal(pacingStrategyLabel(0.1), 'positive')
  assert.equal(pacingStrategyLabel(0), 'even')
})

test('calculatePursuitStrategy returns null for a sub-2-lap event (mirrors v1\'s error path)', () => {
  assert.equal(
    calculatePursuitStrategy({
      trackLengthM: 250,
      laps: 1,
      totalDistanceM: 200,
      targetSeconds: 12,
      startPenaltyS: 5,
      pacingDriftS: 0,
      chainring: 58,
      cog: 15,
    }),
    null
  )
})

test('calculatePursuitStrategy: even split sums exactly to the target time', () => {
  const laps = 16
  const trackLengthM = 250
  const totalDistanceM = 4000
  const targetSeconds = 210 // 3:30.000
  const startPenaltyS = 5
  const pacingDriftS = 0
  const chainring = 58
  const cog = 15

  const result = calculatePursuitStrategy({
    trackLengthM,
    laps,
    totalDistanceM,
    targetSeconds,
    startPenaltyS,
    pacingDriftS,
    chainring,
    cog,
  })

  assert.equal(result.laps.length, laps)
  // Overall time of the final lap must match the (rounded) target time.
  assert.ok(Math.abs(result.laps[laps - 1].overallTimeS - targetSeconds) < 0.01)
  assert.ok(Math.abs(result.elapsedTimeS - targetSeconds) < 0.01)

  // With zero drift every lap from lap 2 onward should have the same (base) lap time.
  const baseLapTime = result.laps[1].lapTimeS
  for (let i = 2; i < laps; i++) {
    assert.equal(result.laps[i].lapTimeS, baseLapTime)
  }
  // Lap 1 carries the full standing-start penalty on top of the base lap time.
  assert.ok(Math.abs(result.laps[0].lapTimeS - (baseLapTime + startPenaltyS)) < 1e-9)

  // Cross-check cadence/speed math against the raw formulas used in v1.
  const gearRatio = chainring / cog
  const revolutionsPerLap = trackLengthM / WHEEL_CIRCUMFERENCE_M
  const expectedCadence = Math.round(
    ((revolutionsPerLap / gearRatio) / baseLapTime) * 60
  )
  assert.equal(result.laps[1].cadenceRpm, expectedCadence)
  const expectedSpeed = Math.round(((trackLengthM / baseLapTime) * 3.6) * 10) / 10
  assert.equal(result.laps[1].speedKmh, expectedSpeed)

  // Average speed/cadence/lap-time summary values.
  assert.ok(Math.abs(result.avgSpeedKmh - (totalDistanceM / 1000) / (targetSeconds / 3600)) < 1e-9)
  assert.ok(Math.abs(result.avgLapTimeS - targetSeconds / laps) < 1e-9)
})

test('calculatePursuitStrategy: positive drift makes each flying lap slower than the last', () => {
  const result = calculatePursuitStrategy({
    trackLengthM: 250,
    laps: 8,
    totalDistanceM: 2000,
    targetSeconds: 150,
    startPenaltyS: 4,
    pacingDriftS: 0.2,
    chainring: 52,
    cog: 14,
  })

  for (let i = 2; i < result.laps.length; i++) {
    assert.ok(result.laps[i].lapTimeS > result.laps[i - 1].lapTimeS)
  }
  assert.ok(Math.abs(result.elapsedTimeS - 150) < 0.01)
})

test('calculatePursuitStrategy: negative drift makes each flying lap faster than the last', () => {
  const result = calculatePursuitStrategy({
    trackLengthM: 250,
    laps: 8,
    totalDistanceM: 2000,
    targetSeconds: 150,
    startPenaltyS: 4,
    pacingDriftS: -0.2,
    chainring: 52,
    cog: 14,
  })

  for (let i = 2; i < result.laps.length; i++) {
    assert.ok(result.laps[i].lapTimeS < result.laps[i - 1].lapTimeS)
  }
  assert.ok(Math.abs(result.elapsedTimeS - 150) < 0.01)
})

test('DISCIPLINES is a non-empty, well-formed reference catalogue', () => {
  assert.ok(DISCIPLINES.length > 0)
  for (const d of DISCIPLINES) {
    assert.equal(typeof d.category, 'string')
    assert.equal(typeof d.name, 'string')
    assert.ok(d.distanceM > 0)
    assert.equal(typeof d.flyingStart, 'boolean')
  }
})
