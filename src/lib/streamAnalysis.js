// src/lib/streamAnalysis.js
//
// Provider-agnostic, stream-based activity analysis (no .fit file). Used as the degraded path
// when a provider (Intervals.icu without a .fit, Strava) only exposes per-second streams. It
// produces the same { summary, curves, time_series } shape as api/analyze.py so the result can
// go straight into buildActivityInsert().

import { deriveSpeedFromCadence, hasSpeedSignal as hasRealSpeedSignal } from './trackGearing.js'
import { deriveSpeedAndDistanceFromGps } from './gpsDistance.js'

export const DURATIONAL_INTERVALS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600]

export function computeDurationalCurve(stream, intervals = DURATIONAL_INTERVALS) {
  if (!stream || stream.length === 0) return null

  const curve = {}
  const n = stream.length

  intervals.forEach((sec) => {
    if (n < sec) return

    let currentSum = 0
    for (let i = 0; i < sec; i++) currentSum += stream[i] || 0
    let maxSum = currentSum

    for (let i = sec; i < n; i++) {
      currentSum += (stream[i] || 0) - (stream[i - sec] || 0)
      if (currentSum > maxSum) maxSum = currentSum
    }

    const label = sec < 60 ? `${sec}s` : sec < 3600 ? `${sec / 60}m` : `${sec / 3600}h`
    curve[label] = Math.round((maxSum / sec) * 10) / 10
  })

  return curve
}

export function meanOf(values) {
  const valid = (values || []).filter((v) => typeof v === 'number' && !isNaN(v))
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

export function computeNormalizedPower(wattsStream, windowSec = 30) {
  if (!wattsStream || wattsStream.length < windowSec) return null

  let sum = 0
  for (let i = 0; i < windowSec; i++) sum += wattsStream[i] || 0
  const rollingAvgs = [sum / windowSec]

  for (let i = windowSec; i < wattsStream.length; i++) {
    sum += (wattsStream[i] || 0) - (wattsStream[i - windowSec] || 0)
    rollingAvgs.push(sum / windowSec)
  }

  const quadMean = meanOf(rollingAvgs.map((v) => v ** 4))
  return quadMean != null ? Math.round(quadMean ** 0.25) : null
}

export function computeElevationChanges(altitudeStream) {
  if (!altitudeStream || altitudeStream.length < 2) return { gain: 0, loss: 0 }

  let gain = 0
  let loss = 0
  for (let i = 1; i < altitudeStream.length; i++) {
    const diff = (altitudeStream[i] ?? altitudeStream[i - 1]) - altitudeStream[i - 1]
    if (diff > 0) gain += diff
    else loss += Math.abs(diff)
  }
  return { gain: Math.round(gain * 10) / 10, loss: Math.round(loss * 10) / 10 }
}

function getMax(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null
  const valid = arr.filter((v) => typeof v === 'number' && !isNaN(v))
  return valid.length > 0 ? Math.max(...valid) : null
}

/**
 * Normalizes a list of `{ type, data, data2 }` streams (Intervals.icu shape; "latlng" carries
 * latitude in `data` and longitude in `data2`) into `{ streams, streams2 }` maps keyed by type.
 */
export function mapStreams(streamsData) {
  const streams = {}
  const streams2 = {}
  ;(streamsData || []).forEach((s) => {
    if (s?.type && Array.isArray(s.data)) streams[s.type] = s.data
    if (s?.type && Array.isArray(s.data2)) streams2[s.type] = s.data2
  })
  return { streams, streams2 }
}

function splitLatLng(streams, streams2) {
  if (Array.isArray(streams.latlng) && streams.latlng.length > 0) {
    if (Array.isArray(streams.latlng[0])) {
      return {
        latitude: streams.latlng.map((p) => (Array.isArray(p) ? p[0] : null)),
        longitude: streams.latlng.map((p) => (Array.isArray(p) ? p[1] : null)),
      }
    }
    if (Array.isArray(streams2.latlng)) {
      return { latitude: streams.latlng, longitude: streams2.latlng }
    }
  }
  return { latitude: null, longitude: null }
}

/**
 * @param {object} streamsData - array of `{ type, data, data2? }` (watts, cadence, heartrate,
 *   velocity_smooth [m/s], latlng, altitude, distance)
 * @param {{ chainring?: number|null, cog?: number|null, isFixedGear?: boolean }} [gearing]
 * @returns {{ summary: object, curves: object, time_series: object }|null} null when no streams
 */
export function analyzeStreams(streamsData, { chainring = null, cog = null, isFixedGear = false } = {}) {
  if (!Array.isArray(streamsData) || streamsData.length === 0) return null

  const { streams, streams2 } = mapStreams(streamsData)

  const speedKmhStream = streams.velocity_smooth
    ? streams.velocity_smooth.map((v) => (v != null ? Math.round(v * 3.6 * 10) / 10 : 0))
    : null
  const { latitude, longitude } = splitLatLng(streams, streams2)

  // Speed source, in order: real sensor -> GPS -> cadence x gear ratio (fixed gear) -> unavailable.
  let effectiveSpeedStream = speedKmhStream
  let speedSource
  let gpsDistanceM = null
  if (hasRealSpeedSignal(speedKmhStream)) {
    speedSource = 'sensor'
  } else if (latitude?.length > 1 && longitude?.length > 1) {
    const gps = deriveSpeedAndDistanceFromGps(latitude, longitude)
    effectiveSpeedStream = gps.speedKmh
    gpsDistanceM = gps.distanceM
    speedSource = 'gps'
  } else if (isFixedGear && chainring && cog && streams.cadence?.length) {
    effectiveSpeedStream = deriveSpeedFromCadence(streams.cadence, chainring, cog)
    speedSource = 'derived_from_cadence'
  } else {
    speedSource = 'unavailable'
  }

  let torqueStream = null
  if (streams.watts && streams.cadence) {
    torqueStream = streams.watts.map((w, idx) => {
      const cad = streams.cadence[idx]
      if (!cad || cad <= 0 || !w) return 0
      return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
    })
  }

  const curves = {}
  if (streams.cadence?.length) curves.Cadence = computeDurationalCurve(streams.cadence)
  if (effectiveSpeedStream?.length) curves.Speed = computeDurationalCurve(effectiveSpeedStream)
  if (streams.watts?.length) curves.Power = computeDurationalCurve(streams.watts)
  if (torqueStream?.length) curves.Torque = computeDurationalCurve(torqueStream)
  if (streams.heartrate?.length) curves.HeartRate = computeDurationalCurve(streams.heartrate)

  const speedKnown = speedSource !== 'unavailable'
  const movingTimeS = speedKnown
    ? (effectiveSpeedStream || []).filter((s) => (s || 0) > 1.0).length || null
    : null

  let distanceM = null
  if (streams.distance?.length) {
    distanceM = Math.round((streams.distance[streams.distance.length - 1] - streams.distance[0]) * 10) / 10
  } else if (speedSource === 'gps' && gpsDistanceM != null) {
    distanceM = gpsDistanceM
  } else if (speedKnown && effectiveSpeedStream?.length) {
    distanceM = Math.round(effectiveSpeedStream.reduce((acc, s) => acc + (s || 0) / 3.6, 0) * 10) / 10
  }

  const { gain: elevationGainM, loss: elevationLossM } = computeElevationChanges(streams.altitude)
  const avgPower = meanOf(streams.watts)
  const avgCadence = meanOf(streams.cadence)
  const avgTorque = meanOf(torqueStream)
  const avgHr = meanOf(streams.heartrate)

  const summary = {
    max_cadence_rpm: getMax(streams.cadence),
    max_speed_kmh: speedKnown ? getMax(effectiveSpeedStream) : null,
    max_power_w: getMax(streams.watts),
    peak_torque_nm: getMax(torqueStream),
    start_time: null,
    elapsed_time_s: streams.watts?.length ? streams.watts.length - 1 : null,
    moving_time_s: movingTimeS,
    distance_m: distanceM,
    avg_speed_kmh: speedKnown ? meanOf(effectiveSpeedStream) : null,
    avg_power_w: avgPower != null ? Math.round(avgPower) : null,
    avg_cadence_rpm: avgCadence != null ? Math.round(avgCadence) : null,
    avg_torque_nm: avgTorque != null ? Math.round(avgTorque * 10) / 10 : null,
    avg_hr: avgHr != null ? Math.round(avgHr) : null,
    max_hr: getMax(streams.heartrate),
    normalized_power_w: computeNormalizedPower(streams.watts),
    elevation_gain_m: elevationGainM,
    elevation_loss_m: elevationLossM,
    speed_source: speedSource,
  }

  const time_series = {
    watts: streams.watts || [],
    cadence: streams.cadence || [],
    torque: torqueStream || [],
    speed: effectiveSpeedStream || [],
    latitude: latitude || [],
    longitude: longitude || [],
    altitude: streams.altitude || [],
  }

  return { summary, curves, time_series }
}
