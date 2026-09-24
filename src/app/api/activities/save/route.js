import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export async function POST(request) {
  try {
    const body = await request.json()
    const {
      title,
      user_id,
      track_id,
      chainring,
      cog,
      crank_length_mm,
      summary,
      curves
    } = body

    // 2. Vložení záznamu do tabulky activities
    const { data: activity, error: actError } = await supabase
      .from('activities')
      .insert({
        user_id: userId,
        track_id: track_id || null,
        title: title || 'Velodrome Session',
        activity_date: new Date().toISOString(),
        chainring: chainring ? parseInt(chainring) : null,
        cog: cog ? parseInt(cog) : null,
        crank_length_mm: crank_length_mm ? parseFloat(crank_length_mm) : 165.0,
        duration_sec: summary?.duration_sec,
        max_cadence_rpm: summary?.max_cadence,
        max_speed_kmh: summary?.max_speed_kmh,
        max_power_w: summary?.max_power_w,
        peak_torque_nm: summary?.peak_torque_nm
      })
      .select()
      .single()

    if (actError) throw actError

    // 3. Hromadné vložení křivek do tabulky activity_curves (JSONB)
    const curveInserts = Object.entries(curves).map(([curveType, data]) => ({
      activity_id: activity.id,
      curve_type: curveType,
      data: data
    }))

    if (curveInserts.length > 0) {
      const { error: curveError } = await supabase
        .from('activity_curves')
        .insert(curveInserts)
      
      if (curveError) throw curveError
    }

    return NextResponse.json({ success: true, activityId: activity.id })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
