// Run with: node --test src/lib/__tests__/gpsDistance.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineDistanceM, deriveSpeedAndDistanceFromGps } from '../gpsDistance.js'

test('haversineDistanceM returns ~0 for identical points', () => {
  assert.ok(haversineDistanceM(50.0, 14.0, 50.0, 14.0) < 1e-6)
})

test('haversineDistanceM matches a known 1-degree-latitude distance (~111.2 km)', () => {
  const d = haversineDistanceM(0, 0, 1, 0)
  assert.ok(Math.abs(d - 111195) < 200)
})

test('deriveSpeedAndDistanceFromGps derives plausible speed from a steady-moving trace', () => {
  // ~0.0001 deg longitude steps along the equator ~= 11.1 m per 1s sample ~= 40 km/h
  const lat = [0, 0, 0, 0]
  const lng = [0, 0.0001, 0.0002, 0.0003]
  const { speedKmh, distanceM } = deriveSpeedAndDistanceFromGps(lat, lng)
  assert.equal(speedKmh.length, 4)
  assert.equal(speedKmh[0], 0) // no prior point to compare against
  assert.ok(speedKmh[1] > 30 && speedKmh[1] < 50)
  assert.ok(distanceM > 30 && distanceM < 40)
})

test('deriveSpeedAndDistanceFromGps skips invalid/missing coordinates without throwing', () => {
  const lat = [0, null, 0, 0]
  const lng = [0, null, 0.0002, 0.0003]
  const result = deriveSpeedAndDistanceFromGps(lat, lng)
  assert.equal(result.speedKmh.length, 4)
  assert.equal(result.speedKmh[1], 0)
})

test('deriveSpeedAndDistanceFromGps returns zero distance/speed for a stationary trace', () => {
  const lat = [50.1, 50.1, 50.1]
  const lng = [14.2, 14.2, 14.2]
  const { speedKmh, distanceM } = deriveSpeedAndDistanceFromGps(lat, lng)
  assert.deepEqual(speedKmh, [0, 0, 0])
  assert.equal(distanceM, 0)
})
