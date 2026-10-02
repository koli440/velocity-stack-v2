import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'

// GET /api/aero-tests - list the signed-in rider's own Aero Lab field tests (issue #50,
// "Aero Lab"). RLS already scopes rows to auth.uid(), this just orders them for the UI.
export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('aero_tests')
      .select('*')
      .order('test_date', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, aeroTests: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/aero-tests - save a new field test (v1's "Save Test to Database" button in
// pages/50_aero_lab.py). The client computes CdA for live display, but we re-derive nothing
// server-side here since, like v1, CdA is the measured outcome of the test itself.
export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      positionName,
      trackId,
      trackName,
      cda,
      speedKmh,
      powerW,
      bike,
      helmet,
      handlebars,
      notes,
    } = body

    if (!positionName || !speedKmh || !powerW) {
      return NextResponse.json(
        { error: 'Missing position name, speed or power' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('aero_tests')
      .insert({
        user_id: user.id,
        track_id: trackId || null,
        track_name: trackName || null,
        position_name: positionName,
        cda: Number(cda) || 0,
        speed_kmh: Number(speedKmh),
        power_w: Number(powerW),
        bike: bike || null,
        helmet: helmet || null,
        handlebars: handlebars || null,
        notes: notes || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, aeroTest: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
