import { NextResponse } from 'next/server'
import { deriveSpeedFromCadence, hasSpeedSignal as hasRealSpeedSignal } from '../../../../lib/trackGearing'
import { deriveSpeedAndDistanceFromGps } from '../../../../lib/gpsDistance'

const DURATIONAL_INTERVALS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600]

// Helper function to compute durational curves
function computeDurationalCurve(stream, intervals = DURATIONAL_INTERVALS) {
  if (!stream || stream.length === 0) return null

  const curve = {}
  const n = stream.length

  intervals.forEach((sec) => {
    if (n < sec) return

    let currentSum = 0
    for (let i = 0; i < sec; i++) {
      currentSum += stream[i] || 0
    }
    let maxSum = currentSum

    for (let i = sec; i < n; i++) {
      currentSum += (stream[i] || 0) - (stream[i - sec] || 0)
      if (currentSum > maxSum) {
        maxSum = currentSum
      }
    }

    const label = sec < 60 ? `${sec}s` : sec < 3600 ? `${sec / 60}m` : `${sec / 3600}h`
    curve[label] = Math.round((maxSum / sec) * 10) / 10
  })

  return curve
}

// The following helper functions (mean/normalized power/elevation) duplicate logic from api/analyze.py
// for the single degraded fallback case: an Intervals.icu ride without an available .fit file
// (see "Attempt B" below). The preferred path is always downloading the .fit file and analyzing it
// via /api/analyze, so that both import paths produce identical metrics (issue #11).
function meanOf(values) {
  const valid = (values || []).filter((v) => typeof v === 'number' && !isNaN(v))
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function computeNormalizedPower(wattsStream, windowSec = 30) {
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

function computeElevationChanges(altitudeStream) {
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

export async function POST(req) {
  try {
    const { athleteId, apiKey, action, activityId, chainring, cog, isFixedGear } = await req.json()

    if (!athleteId || !apiKey) {
      return NextResponse.json(
        { error: 'Missing Intervals Athlete ID or API Key' },
        { status: 400 }
      )
    }

    const authHeader = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

    // 1. Action: list rides from the last 30 days
    if (action === 'list') {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const oldestDateStr = thirtyDaysAgo.toISOString().split('T')[0]

      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/activities?oldest=${oldestDateStr}`,
        {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        }
      )

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json(
          { error: `Intervals.icu API error (${res.status}): ${errText}` },
          { status: res.status }
        )
      }

      const activities = await res.json()
      const rides = activities
        .filter((a) => a.type === 'Ride' || a.type === 'VirtualRide')
        .map((a) => ({
          id: a.id,
          name: a.name,
          start_date_local: a.start_date_local,
          distance_m: a.distance,
          moving_time_s: a.moving_time,
          average_watts: a.average_watts,
          max_watts: a.max_watts,
          average_cadence: a.average_cadence,
        }))

      return NextResponse.json({ success: true, activities: rides })
    }

    // 2. Action: import the selected ride
    if (action === 'import') {
      if (!activityId) {
        return NextResponse.json({ error: 'Missing activityId' }, { status: 400 })
      }

      const actId = String(activityId)

      // Preferred path: download the raw .fit file and let it be analyzed through the same path
      // as a manual upload (/api/analyze). This ensures that the Intervals.icu sync and manual .fit
      // upload produce an identical set of metrics (issue #11) from a single computation engine.
      //
      // The whole block is wrapped in its own try/catch: calling /api/analyze is a network hop to a
      // different (Python) serverless function, which can fail in a way that does not return JSON
      // (timeout, proxy/platform error HTML page, etc.). We must not let such an error bubble up
      // to the outer handler - we need to silently fall back to the degraded fallback below, otherwise
      // the client gets "Unexpected token '<' ... is not valid JSON" instead of a working import.
      try {
        const fileRes = await fetch(`https://intervals.icu/api/v1/activity/${actId}/file`, {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        })

        if (fileRes.ok) {
          const fitBlob = await fileRes.blob()
          if (fitBlob.size > 0) {
            const formData = new FormData()
            formData.append('file', fitBlob, `${actId}.fit`)
            // Track bikes are fixed-gear without a speed sensor - if the .fit file
            // does not contain real speed, /api/analyze derives it from cadence + gear ratio
            // (see api/analyze.py: gear_development_m), just like with a manual upload.
            if (chainring) formData.append('chainring', String(chainring))
            if (cog) formData.append('cog', String(cog))
            if (isFixedGear) formData.append('is_fixed_gear', 'true')

            const analyzeRes = await fetch(new URL('/api/analyze', req.url).toString(), {
              method: 'POST',
              body: formData,
            })

            const analyzeContentType = analyzeRes.headers.get('content-type') || ''
            if (analyzeRes.ok && analyzeContentType.includes('application/json')) {
              const parsedData = await analyzeRes.json()
              if (parsedData?.success) {
                return NextResponse.json({
                  success: true,
                  summary: parsedData.summary,
                  curves: parsedData.curves,
                  time_series: parsedData.time_series || {},
                })
              }
            } else if (!analyzeRes.ok) {
              console.warn(
                `/api/analyze returned ${analyzeRes.status}, falling back to raw Intervals.icu streams for activity ${actId}`
              )
            }
          }
        }
      } catch (analyzeErr) {
        console.warn(
          `Preferred .fit analysis path failed for activity ${actId}, falling back to raw Intervals.icu streams:`,
          analyzeErr.message
        )
      }

      // Degraded fallback: the Intervals.icu ride has no raw .fit file available (e.g. a manual
      // entry), so we rely on their per-second streams and compute the metrics locally.
      const streamsRes = await fetch(
        `https://intervals.icu/api/v1/activity/${actId}/streams?types=watts,cadence,heartrate,velocity_smooth,latlng,altitude,distance`,
        {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        }
      )

      let streamsData = null
      if (streamsRes.ok) {
        streamsData = await streamsRes.json()
      }

      if (!streamsData || !Array.isArray(streamsData) || streamsData.length === 0) {
        return NextResponse.json(
          { error: `No data is available in Intervals.icu for ride ${actId}.` },
          { status: 404 }
        )
      }

      // Map the streams into a convenient dictionary
      // Note: the "latlng" stream returns coordinates split into two parallel arrays -
      // "data" (latitude) and "data2" (longitude), not a single array of [lat, lng] pairs
      const streamsMap = {}
      const streamsMap2 = {}
      streamsData.forEach((s) => {
        if (s?.type && Array.isArray(s.data)) {
          streamsMap[s.type] = s.data
        }
        if (s?.type && Array.isArray(s.data2)) {
          streamsMap2[s.type] = s.data2
        }
      })

      const speedKmhStream = streamsMap.velocity_smooth
        ? streamsMap.velocity_smooth.map((v) => (v != null ? Math.round(v * 3.6 * 10) / 10 : 0))
        : null

      // GPS route: latitude is in streamsMap.latlng.data, longitude in data2 (verified against
      // the Intervals.icu API docs - ActivityStream has separate "data"/"data2" fields for
      // multi-element streams). We keep a fallback to the older [lat, lng] pair format just in case.
      let latitudeStream = null
      let longitudeStream = null
      if (Array.isArray(streamsMap.latlng) && streamsMap.latlng.length > 0) {
        if (Array.isArray(streamsMap.latlng[0])) {
          latitudeStream = streamsMap.latlng.map((pair) => (Array.isArray(pair) ? pair[0] : null))
          longitudeStream = streamsMap.latlng.map((pair) => (Array.isArray(pair) ? pair[1] : null))
        } else if (Array.isArray(streamsMap2.latlng)) {
          latitudeStream = streamsMap.latlng
          longitudeStream = streamsMap2.latlng
        }
      }

      // Speed/distance are not always directly available - depending on what Intervals.icu
      // returns, we choose in this order (same logic as the preferred path via api/analyze.py):
      //   1) "sensor"               - a real (non-zero) "velocity_smooth" stream
      //   2) "gps"                  - no speed sensor, but there is a GPS route -> derive from position
      //                               (works for a road ride with freewheel too)
      //   3) "derived_from_cadence" - no sensor nor GPS, but a fixed-gear (track) bike with a known
      //                               gear ratio -> speed = f(cadence, gear ratio)
      //   4) "unavailable"          - none of the above - better to admit it than to
      //                               silently show zero/incorrect data
      let effectiveSpeedStream = speedKmhStream
      let speedSource = null
      let gpsDistanceM = null
      if (hasRealSpeedSignal(speedKmhStream)) {
        speedSource = 'sensor'
      } else if (latitudeStream?.length > 1 && longitudeStream?.length > 1) {
        const gps = deriveSpeedAndDistanceFromGps(latitudeStream, longitudeStream)
        effectiveSpeedStream = gps.speedKmh
        gpsDistanceM = gps.distanceM
        speedSource = 'gps'
      } else if (isFixedGear && chainring && cog && streamsMap.cadence?.length) {
        effectiveSpeedStream = deriveSpeedFromCadence(streamsMap.cadence, chainring, cog)
        speedSource = 'derived_from_cadence'
      } else {
        speedSource = 'unavailable'
      }

      let torqueStream = null
      if (streamsMap.watts && streamsMap.cadence) {
        torqueStream = streamsMap.watts.map((w, idx) => {
          const cad = streamsMap.cadence[idx]
          if (!cad || cad <= 0 || !w) return 0
          return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
        })
      }

      // Compute the load curves
      const curves = {}
      if (streamsMap.cadence?.length) curves.Cadence = computeDurationalCurve(streamsMap.cadence)
      if (effectiveSpeedStream?.length) curves.Speed = computeDurationalCurve(effectiveSpeedStream)
      if (streamsMap.watts?.length) curves.Power = computeDurationalCurve(streamsMap.watts)
      if (torqueStream?.length) curves.Torque = computeDurationalCurve(torqueStream)
      if (streamsMap.heartrate?.length) curves.HeartRate = computeDurationalCurve(streamsMap.heartrate)

      const getMax = (arr) => {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return null
        const valid = arr.filter((v) => typeof v === 'number' && !isNaN(v))
        return valid.length > 0 ? Math.max(...valid) : null
      }

      // Streams are sampled at ~1Hz, same as in api/analyze.py. If speed is not available at all
      // (speedSource === 'unavailable'), we'd rather return None than a false zero.
      const movingTimeS =
        speedSource !== 'unavailable'
          ? (effectiveSpeedStream || []).filter((s) => (s || 0) > 1.0).length || null
          : null

      // Distance: we prefer the native cumulative stream from Intervals.icu, then the GPS route
      // (if we used it to derive speed above), otherwise we integrate speed.
      let distanceM = null
      if (streamsMap.distance?.length) {
        distanceM =
          Math.round((streamsMap.distance[streamsMap.distance.length - 1] - streamsMap.distance[0]) * 10) /
          10
      } else if (speedSource === 'gps' && gpsDistanceM != null) {
        distanceM = gpsDistanceM
      } else if (speedSource !== 'unavailable' && effectiveSpeedStream?.length) {
        distanceM = Math.round(effectiveSpeedStream.reduce((acc, s) => acc + (s || 0) / 3.6, 0) * 10) / 10
      }
      const { gain: elevationGainM, loss: elevationLossM } = computeElevationChanges(
        streamsMap.altitude
      )
      const avgPower = meanOf(streamsMap.watts)
      const avgCadence = meanOf(streamsMap.cadence)
      const avgTorque = meanOf(torqueStream)
      const avgHr = meanOf(streamsMap.heartrate)

      const summary = {
        max_cadence_rpm: getMax(streamsMap.cadence),
        max_speed_kmh: speedSource !== 'unavailable' ? getMax(effectiveSpeedStream) : null,
        max_power_w: getMax(streamsMap.watts),
        peak_torque_nm: getMax(torqueStream),
        start_time: null,
        elapsed_time_s: streamsMap.watts?.length ? streamsMap.watts.length - 1 : null,
        moving_time_s: movingTimeS,
        distance_m: distanceM,
        avg_speed_kmh: speedSource !== 'unavailable' ? meanOf(effectiveSpeedStream) : null,
        avg_power_w: avgPower != null ? Math.round(avgPower) : null,
        avg_cadence_rpm: avgCadence != null ? Math.round(avgCadence) : null,
        avg_torque_nm: avgTorque != null ? Math.round(avgTorque * 10) / 10 : null,
        avg_hr: avgHr != null ? Math.round(avgHr) : null,
        max_hr: getMax(streamsMap.heartrate),
        normalized_power_w: computeNormalizedPower(streamsMap.watts),
        elevation_gain_m: elevationGainM,
        elevation_loss_m: elevationLossM,
        speed_source: speedSource,
      }

      // Second-by-second time series
      const timeSeries = {
        watts: streamsMap.watts || [],
        cadence: streamsMap.cadence || [],
        torque: torqueStream || [],
        speed: effectiveSpeedStream || [],
        latitude: latitudeStream || [],
        longitude: longitudeStream || [],
        altitude: streamsMap.altitude || [],
      }

      return NextResponse.json({
        success: true,
        summary,
        curves,
        time_series: timeSeries,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}