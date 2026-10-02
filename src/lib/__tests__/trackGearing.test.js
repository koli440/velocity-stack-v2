// src/lib/__tests__/trackGearing.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRACK_WHEEL_DIAMETER_INCHES,
  gearDevelopmentM,
  deriveSpeedFromCadence,
  hasSpeedSignal,
} from '../trackGearing.js'

test('gearDevelopmentM matches the gear-inches formula used elsewhere in the app', () => {
  // gear_inches = (chainring/cog) * 26.8; development_m = gear_inches * PI * 0.0254
  const gearInches = (58 / 14) * TRACK_WHEEL_DIAMETER_INCHES
  const expected = gearInches * Math.PI * 0.0254
  assert.ok(Math.abs(gearDevelopmentM(58, 14) - expected) < 1e-9)
})

test('deriveSpeedFromCadence produces realistic track speeds for a 58/14 gear', () => {
  const speeds = deriveSpeedFromCadence([60, 90, 120], 58, 14)
  assert.equal(speeds.length, 3)
  // Sanity-checked against the manual calculation done while implementing the fix.
  assert.ok(Math.abs(speeds[0] - 31.9) < 0.2)
  assert.ok(Math.abs(speeds[1] - 47.8) < 0.3)
  assert.ok(Math.abs(speeds[2] - 63.8) < 0.3)
})

test('deriveSpeedFromCadence treats non-positive cadence samples as stopped (0 km/h)', () => {
  const speeds = deriveSpeedFromCadence([0, -1, null, undefined, 90], 58, 14)
  assert.deepEqual(speeds.slice(0, 4), [0, 0, 0, 0])
  assert.ok(speeds[4] > 0)
})

test('hasSpeedSignal is false for a flat all-zero stream (no speed sensor in the file)', () => {
  assert.equal(hasSpeedSignal([0, 0, 0, 0]), false)
  assert.equal(hasSpeedSignal([]), false)
  assert.equal(hasSpeedSignal(null), false)
})

test('hasSpeedSignal is true as soon as any sample shows real motion', () => {
  assert.equal(hasSpeedSignal([0, 0, 12.4, 0]), true)
})
