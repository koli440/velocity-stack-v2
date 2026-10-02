// src/lib/aeroLab.js
//
// "Aero Lab" - migrated from v1's pages/50_aero_lab.py. Field-tests a rider's aerodynamic drag
// coefficient (CdA) using the Chung "Virtual Elevation" method's steady-state power balance:
// how much power is needed to overcome air resistance at a given speed, once rolling resistance
// and drivetrain losses are subtracted out. These are pure port-overs of v1's inline math so they
// stay testable independent of the UI.

const GRAVITY = 9.81
// Fixed assumptions v1 hardcoded rather than exposing as inputs: a typical drivetrain efficiency,
// and the ICAO standard atmosphere lapse-rate exponent used to estimate ambient pressure from
// elevation when the rider hasn't measured it directly.
const DRIVETRAIN_EFFICIENCY = 0.97
const SEA_LEVEL_PRESSURE_HPA = 1013.25
const DRY_AIR_GAS_CONSTANT = 287.05

/**
 * Estimates standard atmospheric pressure (hPa) at a given elevation (m), same formula v1 used to
 * pre-fill the "Air Pressure" input before a rider overrides it with a measured value.
 * @param {number} elevationM
 * @returns {number}
 */
export function estimateStandardPressureHpa(elevationM) {
  const elevation = Number(elevationM) || 0
  return SEA_LEVEL_PRESSURE_HPA * Math.pow(1 - 0.0000225577 * elevation, 5.25588)
}

/**
 * Computes air density (rho, kg/m^3) from temperature and pressure, same ideal-gas-law formula
 * v1 used: rho = pressure / (R_dry_air * temp_kelvin).
 * @param {number} tempC
 * @param {number} pressureHpa
 * @returns {number}
 */
export function calculateAirDensity(tempC, pressureHpa) {
  const tempK = (Number(tempC) || 0) + 273.15
  const pressurePa = (Number(pressureHpa) || 0) * 100
  if (tempK <= 0) return 0
  return Math.round((pressurePa / (DRY_AIR_GAS_CONSTANT * tempK)) * 10000) / 10000
}

/**
 * Splits total power into rolling-resistance, aerodynamic and drivetrain losses, same breakdown
 * v1 charted in its "Power Distribution" bar chart.
 * @param {object} params
 * @param {number} params.speedKmh - average speed (km/h)
 * @param {number} params.powerW - average power (W)
 * @param {number} params.totalWeightKg - rider + equipment weight (kg)
 * @param {number} params.crr - coefficient of rolling resistance
 * @returns {{ speedMs: number, powerRollingW: number, powerAeroW: number, powerDrivetrainW: number }}
 */
export function calculatePowerBreakdown({ speedKmh, powerW, totalWeightKg, crr }) {
  const speedMs = (Number(speedKmh) || 0) / 3.6
  const power = Number(powerW) || 0
  const weight = Number(totalWeightKg) || 0
  const rollingResistance = Number(crr) || 0

  const powerRollingW = rollingResistance * weight * GRAVITY * speedMs
  const powerDrivetrainW = power * (1 - DRIVETRAIN_EFFICIENCY)
  const powerAeroW = power * DRIVETRAIN_EFFICIENCY - powerRollingW

  return { speedMs, powerRollingW, powerAeroW, powerDrivetrainW }
}

/**
 * Estimates CdA (m^2) from a field test's raw inputs using the Chung Method's steady-state power
 * balance: aero power = 0.5 * rho * CdA * v^3, solved for CdA. Returns 0 (same as v1) when the
 * inputs don't yield a usable aero power figure (e.g. power too low for the given speed).
 * @param {object} params
 * @param {number} params.speedKmh
 * @param {number} params.powerW
 * @param {number} params.totalWeightKg
 * @param {number} params.crr
 * @param {number} params.airDensity
 * @returns {number}
 */
export function calculateCdA({ speedKmh, powerW, totalWeightKg, crr, airDensity }) {
  const { speedMs, powerAeroW } = calculatePowerBreakdown({ speedKmh, powerW, totalWeightKg, crr })
  const rho = Number(airDensity) || 0

  if (speedMs <= 0 || powerAeroW <= 0 || rho <= 0) return 0

  return powerAeroW / (0.5 * rho * Math.pow(speedMs, 3))
}
