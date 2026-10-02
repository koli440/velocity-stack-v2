// src/lib/__tests__/aeroLab.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateStandardPressureHpa,
  calculateAirDensity,
  calculatePowerBreakdown,
  calculateCdA,
} from '../aeroLab.js'

test('estimateStandardPressureHpa is sea-level standard pressure at 0m elevation', () => {
  assert.ok(Math.abs(estimateStandardPressureHpa(0) - 1013.25) < 1e-6)
})

test('estimateStandardPressureHpa decreases with elevation', () => {
  assert.ok(estimateStandardPressureHpa(1000) < estimateStandardPressureHpa(0))
})

test('calculateAirDensity matches v1 example: 20C at standard sea-level pressure', () => {
  // rho = pressure_pa / (287.05 * temp_k) = 101325 / (287.05 * 293.15) ~ 1.2041 kg/m^3
  const rho = calculateAirDensity(20, 1013.25)
  assert.ok(Math.abs(rho - 1.2041) < 0.001)
})

test('calculatePowerBreakdown matches v1 field-test example (45km/h, 320W, 84.5kg, Crr 0.0020)', () => {
  const { speedMs, powerRollingW, powerAeroW, powerDrivetrainW } = calculatePowerBreakdown({
    speedKmh: 45,
    powerW: 320,
    totalWeightKg: 84.5,
    crr: 0.002,
  })
  assert.ok(Math.abs(speedMs - 12.5) < 0.01)
  // p_rr = 0.0020 * 84.5 * 9.81 * 12.5 ~ 20.72W
  assert.ok(Math.abs(powerRollingW - 20.72) < 0.1)
  // p_aero = 320 * 0.97 - p_rr ~ 289.68W
  assert.ok(Math.abs(powerAeroW - 289.68) < 0.1)
  // drivetrain loss = 320 * (1 - 0.97) = 9.6W
  assert.ok(Math.abs(powerDrivetrainW - 9.6) < 0.01)
})

test('calculateCdA matches v1 field-test example', () => {
  const airDensity = calculateAirDensity(20, 1013.25)
  const cda = calculateCdA({
    speedKmh: 45,
    powerW: 320,
    totalWeightKg: 84.5,
    crr: 0.002,
    airDensity,
  })
  // cda = p_aero / (0.5 * rho * v_ms^3) ~ 289.68 / (0.5 * 1.2041 * 1953.125) ~ 0.2463
  assert.ok(Math.abs(cda - 0.2463) < 0.001)
})

test('calculateCdA returns 0 when power is too low to overcome rolling resistance', () => {
  const cda = calculateCdA({
    speedKmh: 45,
    powerW: 20,
    totalWeightKg: 84.5,
    crr: 0.002,
    airDensity: 1.2,
  })
  assert.equal(cda, 0)
})

test('calculateCdA returns 0 at zero speed', () => {
  const cda = calculateCdA({
    speedKmh: 0,
    powerW: 320,
    totalWeightKg: 84.5,
    crr: 0.002,
    airDensity: 1.2,
  })
  assert.equal(cda, 0)
})
