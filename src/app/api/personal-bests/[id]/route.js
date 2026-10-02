import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { calculateAvgSpeedKmh, getDisciplineDistance } from '../../../../lib/pbVault'

// GET /api/personal-bests/:id - fetch a single owned PB record (v1's 31_PB_detail.py).
export async function GET(req, { params }) {
  try {
    const { id } = params
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('personal_bests')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    if (data.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({ success: true, personalBest: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/personal-bests/:id - edit a PB record (v1's "Save All Changes" button). Re-derives
// avg_speed_kmh whenever the time changes, same as the create path.
export async function PATCH(req, { params }) {
  try {
    const { id } = params
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('personal_bests')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const {
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

    const updates = { updated_at: new Date().toISOString() }
    if (eventName !== undefined) updates.event_name = eventName || null
    if (achievedDate !== undefined) updates.achieved_date = achievedDate
    if (chainring !== undefined) updates.chainring = chainring ? Number(chainring) : null
    if (cog !== undefined) updates.cog = cog ? Number(cog) : null
    if (splitMode !== undefined) updates.split_mode = splitMode === 'distance' ? 'distance' : 'laps'
    if (splitDistanceM !== undefined) {
      updates.split_distance_m = splitDistanceM ? Number(splitDistanceM) : null
    }
    if (lapTimes !== undefined) {
      updates.lap_times = Array.isArray(lapTimes) ? lapTimes.map(Number) : []
    }
    if (notes !== undefined) updates.notes = notes || null

    if (timeSeconds !== undefined && Number(timeSeconds) > 0) {
      const distanceM = existing.discipline_distance_m || getDisciplineDistance(existing.discipline)
      updates.time_seconds = Number(timeSeconds)
      updates.avg_speed_kmh = calculateAvgSpeedKmh(distanceM, Number(timeSeconds))
    }

    const { data, error } = await supabase
      .from('personal_bests')
      .update(updates)
      .eq('id', id)
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

// DELETE /api/personal-bests/:id - permanently remove an owned PB record.
export async function DELETE(req, { params }) {
  try {
    const { id } = params
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('personal_bests')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase.from('personal_bests').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
