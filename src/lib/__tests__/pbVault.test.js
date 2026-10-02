// src/lib/__tests__/pbVault.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCIPLINES,
  getDisciplineDistance,
  formatTime,
  minutesSecondsToTotalSeconds,
  totalSecondsToMinutesSeconds,
  calculateAvgSpeedKmh,
  countSplits,
  buildLapAnalysis,
  formatDate,
} from '../pbVault.js'

test('getDisciplineDistance resolves known disciplines and falls back to null', () => {
  assert.equal(getDisciplineDistance('Kilo (1km Time Trial)'), 1000)
  assert.equal(getDisciplineDistance('Individual Pursuit (Men)'), 4000)
  assert.equal(getDisciplineDistance('Some Unknown Event'), null)
})

test('DISCIPLINES catalogue has unique names and positive distances', () => {
  const names = DISCIPLINES.map((d) => d.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(DISCIPLINES.every((d) => d.distanceM > 0))
})

test('formatTime renders M:SS.mmm like v1\'s format_time()', () => {
  assert.equal(formatTime(210), '3:30.000')
  assert.equal(formatTime(5), '0:05.000')
  assert.equal(formatTime(65.5), '1:05.500')
  assert.equal(formatTime(3723.125), '62:03.125')
})

test('formatTime handles missing/invalid input defensively', () => {
  assert.equal(formatTime(null), '--:--')
  assert.equal(formatTime(undefined), '--:--')
  assert.equal(formatTime(-5), '--:--')
  assert.equal(formatTime(NaN), '--:--')
})

test('minutesSecondsToTotalSeconds / totalSecondsToMinutesSeconds round-trip', () => {
  assert.equal(minutesSecondsToTotalSeconds(4, 20), 260)
  assert.deepEqual(totalSecondsToMinutesSeconds(260), { minutes: 4, seconds: 20 })
  assert.deepEqual(totalSecondsToMinutesSeconds(65.5), { minutes: 1, seconds: 5.5 })
})

test('calculateAvgSpeedKmh matches v1\'s (distance / seconds) * 3.6 formula', () => {
  // 4000m in 260s -> 55.3846... km/h, rounded to 2dp.
  assert.equal(calculateAvgSpeedKmh(4000, 260), 55.38)
  assert.equal(calculateAvgSpeedKmh(1000, 65), 55.38)
})

test('calculateAvgSpeedKmh handles invalid inputs defensively', () => {
  assert.equal(calculateAvgSpeedKmh(0, 100), 0)
  assert.equal(calculateAvgSpeedKmh(100, 0), 0)
  assert.equal(calculateAvgSpeedKmh(100, -5), 0)
})

test('countSplits floors like v1\'s int(discipline_dist / current_split_dist)', () => {
  assert.equal(countSplits(4000, 250), 16)
  assert.equal(countSplits(1000, 300), 3)
  assert.equal(countSplits(0, 250), 0)
  assert.equal(countSplits(1000, 0), 0)
})

test('buildLapAnalysis computes cumulative time, speed and distance per segment', () => {
  const result = buildLapAnalysis([14.5, 13.2, 13.1], 250)
  assert.equal(result.length, 3)
  assert.equal(result[0].segment, 1)
  assert.equal(result[0].totalTime, 14.5)
  assert.equal(result[1].totalTime, 27.7)
  assert.equal(result[2].totalTime, 40.8)
  assert.equal(result[0].distanceM, 250)
  assert.equal(result[2].distanceM, 750)
  // 250 / 14.5 * 3.6 = 62.0689... rounded to 62.07
  assert.equal(result[0].speedKmh, 62.07)
})

test('buildLapAnalysis returns an empty array for no lap times', () => {
  assert.deepEqual(buildLapAnalysis([], 250), [])
  assert.deepEqual(buildLapAnalysis(null, 250), [])
})

test('formatDate renders DD. MM. YYYY like v1\'s format_date()', () => {
  assert.equal(formatDate('2026-03-05'), '05. 03. 2026')
  assert.equal(formatDate('2026-12-25'), '25. 12. 2026')
})

test('formatDate handles missing/invalid input defensively', () => {
  assert.equal(formatDate(''), '')
  assert.equal(formatDate(null), '')
  assert.equal(formatDate('not-a-date'), '')
})
