import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { calculateAvgSpeedKmh, getDisciplineDistance } from '../../../lib/pbVault'

// GET /api/personal-bests - list the signed-in rider's own Personal Best records (issue #50,
// "PB Vault"). RLS already scopes rows to auth.uid(), this just orders them for the UI.
export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('personal_bests')
      .select('*')
      .order('achieved_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, personalBests: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/personal-bests - log a new Personal Best (v1's "Save to My Vault" button in
// pages/30_PB_vault.py). discipline_distance_m and avg_speed_kmh are derived server-side so a
// tampered client payload can't desync them from the submitted time.
export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      discipline,
      trackId,
      trackName,
      eventName,
      achievedDate,
      timeSeconds,
      chainring,
      cog,
      splitMode,
      splitDistanceM,
      lapTimes,
      notes,
    } = body

    if (!discipline || !timeSeconds || Number(timeSeconds) <= 0) {
      return NextResponse.json({ error: 'Missing discipline or time' }, { status: 400 })
    }

    const distanceM = getDisciplineDistance(discipline)
    if (!distanceM) {
      return NextResponse.json({ error: 'Unknown discipline' }, { status: 400 })
    }

    const avgSpeedKmh = calculateAvgSpeedKmh(distanceM, Number(timeSeconds))

    const { data, error } = await supabase
      .from('personal_bests')
      .insert({
        user_id: user.id,
        track_id: trackId || null,
        track_name: trackName || null,
        discipline,
        discipline_distance_m: distanceM,
        event_name: eventName || null,
        achieved_date: achievedDate || new Date().toISOString().slice(0, 10),
        time_seconds: Number(timeSeconds),
        avg_speed_kmh: avgSpeedKmh,
        chainring: chainring ? Number(chainring) : null,
        cog: cog ? Number(cog) : null,
        split_mode: splitMode === 'distance' ? 'distance' : 'laps',
        split_distance_m: splitDistanceM ? Number(splitDistanceM) : null,
        lap_times: Array.isArray(lapTimes) ? lapTimes.map(Number) : [],
        notes: notes || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, personalBest: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
