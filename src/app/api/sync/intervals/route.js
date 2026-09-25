import { NextResponse } from 'next/server'

// Pomocná funkce pro výpočet durational curves
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

      // Ponecháváme nezkrácené ActivityID přesně tak, jak přišlo (např. "i190168699")
      const actId = String(activityId)

      // Pokus A: Stažení vteřinových streamů
      const streamsRes = await fetch(
        `https://intervals.icu/api/v1/activity/${actId}/streams`,
        {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        }
      )

      let streamsData = null
      if (streamsRes.ok) {
        streamsData = await streamsRes.json()
      }

      // Pokus B: Fallback na stažení souboru .fit, pokud streamy vrátily 404
      if (!streamsData || !Array.isArray(streamsData) || streamsData.length === 0) {
        const fileRes = await fetch(
          `https://intervals.icu/api/v1/activity/${actId}/file`,
          {
            headers: { Authorization: authHeader },
            cache: 'no-store',
          }
        )

        if (fileRes.ok) {
          const fitBlob = await fileRes.blob()
          const formData = new FormData()
          formData.append('file', fitBlob, `${actId}.fit`)

          const analyzeRes = await fetch(
            new URL('/api/analyze', req.url).toString(),
            {
              method: 'POST',
              body: formData,
            }
          )

          if (analyzeRes.ok) {
            const parsedData = await analyzeRes.json()
            return NextResponse.json({
              success: true,
              summary: parsedData.summary,
              curves: parsedData.curves,
            })
          }
        }

        return NextResponse.json(
          { error: `Pro jízdu ${actId} nejsou v Intervals.icu dostupná žádná data ani streamy.` },
          { status: 404 }
        )
      }

      // Zpracování streamů z Pokusu A
      const streamsMap = {}
      streamsData.forEach((s) => {
        if (s?.type && Array.isArray(s.data)) {
          streamsMap[s.type] = s.data
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