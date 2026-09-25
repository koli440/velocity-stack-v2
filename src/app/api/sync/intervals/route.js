import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function computeDurationalCurve(stream, intervals = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600]) {
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

// 1. Ověření při registraci Webhooku (Intervals challenge handshake)
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('challenge') || searchParams.get('echo')

  if (challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return NextResponse.json({ status: 'VelocityStack Intervals Webhook Active' })
}

// 2. Příchozí notifikace o nahrané aktivitě
export async function POST(req) {
  try {
    const payload = await req.json()
    console.log('Incoming Intervals Webhook:', JSON.stringify(payload))

    const athleteId = payload.athleteId || payload.athlete?.id
    const activity = payload.activity || payload

    if (!athleteId || !activity?.id) {
      return NextResponse.json({ message: 'Ignored: No athlete or activity ID' }, { status: 200 })
    }

    if (activity.type && activity.type !== 'Ride' && activity.type !== 'VirtualRide') {
      return NextResponse.json({ message: 'Ignored: Non-ride activity' }, { status: 200 })
    }

    // 1. Dohledání profilu sportovce podle athleteId
    const cleanAthleteId = String(athleteId).replace(/^i/, '')
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, intervals_api_key, home_track_id, default_chainring, default_cog')
      .or(`intervals_athlete_id.eq.${athleteId},intervals_athlete_id.eq.i${cleanAthleteId},intervals_athlete_id.eq.${cleanAthleteId}`)
      .maybeSingle()

    if (profErr || !profile || !profile.intervals_api_key) {
      console.warn(`Profile for athlete ${athleteId} not found or missing API key`)
      return NextResponse.json({ message: 'User not registered for sync' }, { status: 200 })
    }

    // ZACHOVÁVÁME originální ID aktivity (např. "i190168699")
    const activityId = String(activity.id)
    const activityDate = new Date(activity.start_date_local || activity.start_date || Date.now()).toISOString()

    // 2. Kontrola duplicit
    const { data: existingAct } = await supabase
      .from('activities')
      .select('id')
      .eq('user_id', profile.id)
      .eq('title', activity.name || 'Velodrome Session')
      .eq('activity_date', activityDate)
      .maybeSingle()

    if (existingAct) {
      return NextResponse.json({ message: 'Activity already processed' }, { status: 200 })
    }

    const authHeader = `Basic ${Buffer.from(`API_KEY:${profile.intervals_api_key}`).toString('base64')}`

    // 3. Stažení streamů přímo s původním activityId
    const streamsRes = await fetch(
      `https://intervals.icu/api/v1/activity/${activityId}/streams`,
      {
        headers: { Authorization: authHeader },
        cache: 'no-store',
      }
    )

    let streamsData = null
    if (streamsRes.ok) {
      streamsData = await streamsRes.json()
    }

    let summary = {}
    let curves = {}

    // Fallback: Pokud streamy selhaly, zkusíme stáhnout originální .fit soubor
    if (!streamsData || !Array.isArray(streamsData) || streamsData.length === 0) {
      const fileRes = await fetch(
        `https://intervals.icu/api/v1/activity/${activityId}/file`,
        {
          headers: { Authorization: authHeader },
          cache: 'no-store',
        }
      )

      if (fileRes.ok) {
        const fitBlob = await fileRes.blob()
        const formData = new FormData()
        formData.append('file', fitBlob, `${activityId}.fit`)

        const analyzeRes = await fetch(
          new URL('/api/analyze', req.url).toString(),
          {
            method: 'POST',
            body: formData,
          }
        )

        if (analyzeRes.ok) {
          const parsed = await analyzeRes.json()
          summary = parsed.summary || {}
          curves = parsed.curves || {}
        }
      }
    } else {
      // Zpracování streamů získaných z API
      const streamsMap = {}
      streamsData.forEach((s) => {
        if (s?.type && Array.isArray(s.data)) streamsMap[s.type] = s.data
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

      summary = {
        max_cadence: getMax(streamsMap.cadence),
        max_speed_kmh: getMax(speedKmhStream),
        max_power_w: getMax(streamsMap.watts),
        peak_torque_nm: getMax(torqueStream),
      }
    }

    // 4. Zápis jízdy do tabulky activities
    const { data: actRow, error: actErr } = await supabase
      .from('activities')
      .insert({
        user_id: profile.id,
        title: activity.name || 'Velodrome Session',
        track_id: profile.home_track_id || null,
        chainring: profile.default_chainring || 58,
        cog: profile.default_cog || 14,
        crank_length_mm: 165.0,
        max_cadence_rpm: summary.max_cadence ?? null,
        max_speed_kmh: summary.max_speed_kmh ?? null,
        max_power_w: summary.max_power_w ?? null,
        peak_torque_nm: summary.peak_torque_nm ?? null,
        activity_date: activityDate,
      })
      .select()
      .single()

    if (actErr) throw actErr

    // 5. Zápis křivek do tabulky activity_curves
    if (Object.keys(curves).length > 0) {
      const curveRows = Object.entries(curves).map(([type, data]) => ({
        activity_id: actRow.id,
        curve_type: type,
        data: data,
      }))
      await supabase.from('activity_curves').insert(curveRows)
    }

    console.log(`Auto-synced activity ${actRow.id} for athlete ${athleteId}`)
    return NextResponse.json({ success: true, activityId: actRow.id })
  } catch (err) {
    console.error('Webhook processing failed:', err.message)
    return NextResponse.json({ error: err.message }, { status: 200 })
  }
}