import { NextResponse } from 'next/server'

const DURATIONAL_INTERVALS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600]

// Pomocná funkce pro výpočet durational curves
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

// Následující pomocné funkce (mean/normalized power/elevation) duplikují logiku z api/analyze.py
// pro jediný degradovaný fallback případ: jízdu na Intervals.icu bez dostupného .fit souboru
// (viz "Pokus B" níže). Preferovanou cestou je vždy stažení .fit a jeho analýza přes /api/analyze,
// aby obě cesty importu produkovaly identické metriky (issue #11).
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
    const { athleteId, apiKey, action, activityId } = await req.json()

    if (!athleteId || !apiKey) {
      return NextResponse.json(
        { error: 'Chybí Intervals Athlete ID nebo API Key' },
        { status: 400 }
      )
    }

    const authHeader = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

    // 1. Akce: Seznam jízd za posledních 30 dní
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

    // 2. Akce: Import vybrané jízdy
    if (action === 'import') {
      if (!activityId) {
        return NextResponse.json({ error: 'Missing activityId' }, { status: 400 })
      }

      const actId = String(activityId)

      // Preferovaná cesta: stáhnout surový .fit soubor a nechat ho analyzovat tou samou cestou
      // jako ruční upload (/api/analyze). Tím zajistíme, že Intervals.icu sync a manuální .fit
      // upload produkují identickou sadu metrik (issue #11) z jediného výpočetního enginu.
      const fileRes = await fetch(`https://intervals.icu/api/v1/activity/${actId}/file`, {
        headers: { Authorization: authHeader },
        cache: 'no-store',
      })

      if (fileRes.ok) {
        const fitBlob = await fileRes.blob()
        if (fitBlob.size > 0) {
          const formData = new FormData()
          formData.append('file', fitBlob, `${actId}.fit`)

          const analyzeRes = await fetch(new URL('/api/analyze', req.url).toString(), {
            method: 'POST',
            body: formData,
          })

          if (analyzeRes.ok) {
            const parsedData = await analyzeRes.json()
            if (parsedData?.success) {
              return NextResponse.json({
                success: true,
                summary: parsedData.summary,
                curves: parsedData.curves,
                time_series: parsedData.time_series || {},
              })
            }
          }
        }
      }

      // Degradovaný fallback: jízda na Intervals.icu nemá dostupný raw .fit soubor (např. ruční
      // záznam), takže se spoléháme na jejich vteřinové streamy a dopočítáme metriky lokálně.
      const streamsRes = await fetch(
        `https://intervals.icu/api/v1/activity/${actId}/streams?types=watts,cadence,heartrate,velocity_smooth,latlng,altitude`,
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
          { error: `Pro jízdu ${actId} nejsou v Intervals.icu dostupná žádná data.` },
          { status: 404 }
        )
      }

      // Namapování streamů do přehledného slovníku
      // Pozn.: stream "latlng" vrací souřadnice rozdělené do dvou paralelních polí -
      // "data" (latitude) a "data2" (longitude), nikoliv jedno pole dvojic [lat, lng]
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

      let torqueStream = null
      if (streamsMap.watts && streamsMap.cadence) {
        torqueStream = streamsMap.watts.map((w, idx) => {
          const cad = streamsMap.cadence[idx]
          if (!cad || cad <= 0 || !w) return 0
          return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
        })
      }

      // GPS trasa: latitude je v streamsMap.latlng.data, longitude v data2 (ověřeno dokumentací
      // Intervals.icu API - ActivityStream má oddělená pole "data"/"data2" pro víceprvkové streamy).
      // Ponecháváme fallback na starší formát páru [lat, lng] pro jistotu.
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

      // Výpočet zátěžových křivek
      const curves = {}
      if (streamsMap.cadence?.length) curves.Cadence = computeDurationalCurve(streamsMap.cadence)
      if (speedKmhStream?.length) curves.Speed = computeDurationalCurve(speedKmhStream)
      if (streamsMap.watts?.length) curves.Power = computeDurationalCurve(streamsMap.watts)
      if (torqueStream?.length) curves.Torque = computeDurationalCurve(torqueStream)
      if (streamsMap.heartrate?.length) curves.HeartRate = computeDurationalCurve(streamsMap.heartrate)

      const getMax = (arr) => {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return null
        const valid = arr.filter((v) => typeof v === 'number' && !isNaN(v))
        return valid.length > 0 ? Math.max(...valid) : null
      }

      // Streamy jsou vzorkovány ~1Hz, stejně jako v api/analyze.py.
      const movingTimeS = (speedKmhStream || []).filter((s) => (s || 0) > 1.0).length || null
      const distanceM = speedKmhStream?.length
        ? Math.round(speedKmhStream.reduce((acc, s) => acc + (s || 0) / 3.6, 0) * 10) / 10
        : null
      const { gain: elevationGainM, loss: elevationLossM } = computeElevationChanges(
        streamsMap.altitude
      )
      const avgPower = meanOf(streamsMap.watts)
      const avgCadence = meanOf(streamsMap.cadence)
      const avgTorque = meanOf(torqueStream)
      const avgHr = meanOf(streamsMap.heartrate)

      const summary = {
        max_cadence_rpm: getMax(streamsMap.cadence),
        max_speed_kmh: getMax(speedKmhStream),
        max_power_w: getMax(streamsMap.watts),
        peak_torque_nm: getMax(torqueStream),
        start_time: null,
        elapsed_time_s: streamsMap.watts?.length ? streamsMap.watts.length - 1 : null,
        moving_time_s: movingTimeS,
        distance_m: distanceM,
        avg_speed_kmh: meanOf(speedKmhStream),
        avg_power_w: avgPower != null ? Math.round(avgPower) : null,
        avg_cadence_rpm: avgCadence != null ? Math.round(avgCadence) : null,
        avg_torque_nm: avgTorque != null ? Math.round(avgTorque * 10) / 10 : null,
        avg_hr: avgHr != null ? Math.round(avgHr) : null,
        max_hr: getMax(streamsMap.heartrate),
        normalized_power_w: computeNormalizedPower(streamsMap.watts),
        elevation_gain_m: elevationGainM,
        elevation_loss_m: elevationLossM,
      }

      // Časová řada vteřinu po vteřině
      const timeSeries = {
        watts: streamsMap.watts || [],
        cadence: streamsMap.cadence || [],
        torque: torqueStream || [],
        speed: speedKmhStream || [],
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