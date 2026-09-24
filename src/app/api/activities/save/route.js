import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are not configured in environment variables' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const body = await request.json()
    const {
      user_id,          // <--- Přichází z frontendu jako user_id
      title,
      track_id,
      chainring,
      cog,
      crank_length_mm,
      summary,
      curves
    } = body

    // 1. Zajištění platné proměnné userId
    const currentUserId = user_id || null

    // 2. Vložení aktivity do tabulky activities
    const { data: activity, error: actError } = await supabase
      .from('activities')
      .insert({
        user_id: currentUserId,   // <--- Použijeme bezpečně definovanou proměnnou
        track_id: track_id || null,
        title: title || 'Velodrome Session',
        activity_date: new Date().toISOString(),
        chainring: chainring ? parseInt(chainring) : null,
        cog: cog ? parseInt(cog) : null,
        crank_length_mm: crank_length_mm ? parseFloat(crank_length_mm) : 165.0,
        duration_sec: summary?.duration_sec || null,
        max_cadence_rpm: summary?.max_cadence || null,
        max_speed_kmh: summary?.max_speed_kmh || null,
        max_power_w: summary?.max_power_w || null,
        peak_torque_nm: summary?.peak_torque_nm || null
      })
      .select()
      .single()

    if (actError) {
      return NextResponse.json({ error: `Activity insert failed: ${actError.message}` }, { status: 400 })
    }

    // 3. Vložení křivek do tabulky activity_curves
    if (curves && Object.keys(curves).length > 0) {
      const curveInserts = Object.entries(curves).map(([curveType, data]) => ({
        activity_id: activity.id,
        curve_type: curveType,
        data: data
      }))

      const { error: curveError } = await supabase
        .from('activity_curves')
        .insert(curveInserts)

      if (curveError) {
        return NextResponse.json({ error: `Curves insert failed: ${curveError.message}` }, { status: 400 })
      }
    }

    return NextResponse.json({ success: true, activityId: activity.id })
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
