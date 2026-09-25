import { NextResponse } from 'next/server'

// Pomocná funkce pro výpočet durational curves z vteřinových streamů
function computeDurationalCurve(stream, intervals = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600]) {
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

export async function POST(req) {
  try {
    const { athleteId, apiKey, action, activityId } = await req.json()

    if (!athleteId || !apiKey) {
      return NextResponse.json(
        { error: 'Missing Intervals Athlete ID or API Key' },
        { status: 400 }
      )
    }

    const authHeader = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

    // 1. Akce: Načtení seznamu nedávných jízd
    if (action === 'list') {
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/activities?limit=15`,
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
      // Filtrujeme na cyklistické jízdy (Ride, VirtualRide)
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

    // 2. Akce: Stažení vteřinových streamů a výpočet křivek pro vybranou aktivitu
    if (action === 'import') {
      if (!activityId) {
        return NextResponse.json({ error: 'Missing activityId' }, { status: 400 })
      }

      // Stažení streamů: cadence, watts, velocity_smooth, heartrate
      const streamsRes = await fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/activities/${activityId}/streams`,
        {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        }
      )

      if (!streamsRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch activity streams from Intervals.icu` },
          { status: streamsRes.status }
        )
      }

      const streamsData = await streamsRes.json()
      const streamsMap = {}
      streamsData.forEach((s) => {
        streamsMap[s.type] = s.data
      })

      // Převod velocity_smooth z m/s na km/h (* 3.6)
      const speedKmhStream = streamsMap.velocity_smooth
        ? streamsMap.velocity_smooth.map((v) => (v ? Math.round(v * 3.6 * 10) / 10 : 0))
        : null

      // Výpočet Torque z watts a cadence: Torque (Nm) = (watts * 60) / (2 * PI * cadence)
      let torqueStream = null
      if (streamsMap.watts && streamsMap.cadence) {
        torqueStream = streamsMap.watts.map((w, idx) => {
          const cad = streamsMap.cadence[idx]
          if (!cad || cad <= 0 || !w) return 0
          return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
        })
      }

      // Výpočet křivek (Durational Curves)
      const curves = {}
      if (streamsMap.cadence) curves.Cadence = computeDurationalCurve(streamsMap.cadence)
      if (speedKmhStream) curves.Speed = computeDurationalCurve(speedKmhStream)
      if (streamsMap.watts) curves.Power = computeDurationalCurve(streamsMap.watts)
      if (torqueStream) curves.Torque = computeDurationalCurve(torqueStream)
      if (streamsMap.heartrate) curves.HeartRate = computeDurationalCurve(streamsMap.heartrate)

      // Výpočet souhrnných KPI
      const summary = {
        max_cadence: streamsMap.cadence ? Math.max(...streamsMap.cadence) : null,
        max_speed_kmh: speedKmhStream ? Math.max(...speedKmhStream) : null,
        max_power_w: streamsMap.watts ? Math.max(...streamsMap.watts) : null,
        peak_torque_nm: torqueStream ? Math.max(...torqueStream) : null,
      }

      return NextResponse.json({
        success: true,
        summary,
        curves,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}