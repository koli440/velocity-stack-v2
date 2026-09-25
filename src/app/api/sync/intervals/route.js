import { NextResponse } from 'next/server'

// Pomocná funkce pro výpočet durational curves (klouzavé průměry)
function computeDurationalCurve(
  stream,
  intervals = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600]
) {
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
        { error: 'Chybí Intervals Athlete ID nebo API Key' },
        { status: 400 }
      )
    }

    // Basic Auth autorizace pro Intervals.icu API
    const authHeader = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

    // 1. Akce: Načtení seznamu nedávných jízd (posledních 30 dní)
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

    // 2. Akce: Stažení vteřinových streamů a výpočet křivek
    if (action === 'import') {
      if (!activityId) {
        return NextResponse.json({ error: 'Missing activityId' }, { status: 400 })
      }

      // Voláme endpoint BEZ restriktivního parametru ?types=...
      // Intervals.icu tak vrátí pouze streamy, které jízda skutečně má (i kdyby to byl jen time a speed/cadence)
      const streamsUrl = `https://intervals.icu/api/v1/athlete/${athleteId}/activities/${activityId}/streams`

      const streamsRes = await fetch(streamsUrl, {
        headers: { Authorization: authHeader },
        cache: 'no-store',
      })

      if (!streamsRes.ok) {
        const errText = await streamsRes.text()
        console.error(`Intervals streams error (${streamsRes.status}):`, errText)
        return NextResponse.json(
          { error: `Intervals.icu streams error (${streamsRes.status}): ${errText}` },
          { status: streamsRes.status }
        )
      }

      const streamsData = await streamsRes.json()

      if (!Array.isArray(streamsData) || streamsData.length === 0) {
        return NextResponse.json(
          { error: 'Pro tuto jízdu nejsou v Intervals.icu k dispozici žádné sekundové streamy.' },
          { status: 400 }
        )
      }

      // Namapujeme existující streamy
      const streamsMap = {}
      streamsData.forEach((s) => {
        if (s && s.type && Array.isArray(s.data)) {
          streamsMap[s.type] = s.data
        }
      })

      // Převod rychlosti z m/s na km/h (* 3.6), pokud existuje
      const speedKmhStream = streamsMap.velocity_smooth
        ? streamsMap.velocity_smooth.map((v) => (v != null ? Math.round(v * 3.6 * 10) / 10 : 0))
        : null

      // Výpočet Torque (Nm) POUZE pokud existují watty i kadence
      let torqueStream = null
      if (streamsMap.watts && streamsMap.cadence) {
        torqueStream = streamsMap.watts.map((w, idx) => {
          const cad = streamsMap.cadence[idx]
          if (!cad || cad <= 0 || !w) return 0
          return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
        })
      }

      // Výpočet křivek pouze z těch senzorů, které jsou přítomny
      const curves = {}
      if (streamsMap.cadence && streamsMap.cadence.length > 0) {
        const c = computeDurationalCurve(streamsMap.cadence)
        if (c) curves.Cadence = c
      }
      if (speedKmhStream && speedKmhStream.length > 0) {
        const c = computeDurationalCurve(speedKmhStream)
        if (c) curves.Speed = c
      }
      if (streamsMap.watts && streamsMap.watts.length > 0) {
        const c = computeDurationalCurve(streamsMap.watts)
        if (c) curves.Power = c
      }
      if (torqueStream && torqueStream.length > 0) {
        const c = computeDurationalCurve(torqueStream)
        if (c) curves.Torque = c
      }
      if (streamsMap.heartrate && streamsMap.heartrate.length > 0) {
        const c = computeDurationalCurve(streamsMap.heartrate)
        if (c) curves.HeartRate = c
      }

      const getMax = (arr) => {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return null
        const valid = arr.filter((v) => typeof v === 'number' && !isNaN(v))
        return valid.length > 0 ? Math.max(...valid) : null
      }

      const summary = {
        max_cadence: getMax(streamsMap.cadence),
        max_speed_kmh: getMax(speedKmhStream),
        max_power_w: getMax(streamsMap.watts),
        peak_torque_nm: getMax(torqueStream),
      }

      return NextResponse.json({
        success: true,
        summary,
        curves,
      })
    }

      const streamsMap = {}
      streamsData.forEach((s) => {
        if (s && s.type && Array.isArray(s.data)) {
          streamsMap[s.type] = s.data
        }
      })

      // Převod m/s na km/h (* 3.6)
      const speedKmhStream = streamsMap.velocity_smooth
        ? streamsMap.velocity_smooth.map((v) => (v != null ? Math.round(v * 3.6 * 10) / 10 : 0))
        : null

      // Výpočet Torque (Nm): (watts * 60) / (2 * PI * cadence)
      let torqueStream = null
      if (streamsMap.watts && streamsMap.cadence) {
        torqueStream = streamsMap.watts.map((w, idx) => {
          const cad = streamsMap.cadence[idx]
          if (!cad || cad <= 0 || !w) return 0
          return Math.round(((w * 60) / (2 * Math.PI * cad)) * 10) / 10
        })
      }

      const curves = {}
      if (streamsMap.cadence) curves.Cadence = computeDurationalCurve(streamsMap.cadence)
      if (speedKmhStream) curves.Speed = computeDurationalCurve(speedKmhStream)
      if (streamsMap.watts) curves.Power = computeDurationalCurve(streamsMap.watts)
      if (torqueStream) curves.Torque = computeDurationalCurve(torqueStream)
      if (streamsMap.heartrate) curves.HeartRate = computeDurationalCurve(streamsMap.heartrate)

      const getMax = (arr) =>
        arr && arr.length > 0
          ? Math.max(...arr.filter((v) => typeof v === 'number' && !isNaN(v)))
          : null

      const summary = {
        max_cadence: getMax(streamsMap.cadence),
        max_speed_kmh: getMax(speedKmhStream),
        max_power_w: getMax(streamsMap.watts),
        peak_torque_nm: getMax(torqueStream),
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