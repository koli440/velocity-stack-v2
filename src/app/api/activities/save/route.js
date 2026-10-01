import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const cookieStore = cookies()

    // Vytvoříme klienta navázaného na session přihlášeného uživatele
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get(name) {
            return cookieStore.get(name)?.value
          },
          set(name, value, options) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name, options) {
            cookieStore.set({ name, value: '', ...options })
          },
        },
      }
    )

    // Získáme ověřenou identitu uživatele z tokenu (nikoliv z body!)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: Neplatná nebo chybějící session.' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const {
      title,
      track_id,
      chainring,
      cog,
      crank_length_mm,
      summary,
      curves,
      time_series,
      raw_file_url,
      file_sha256,
    } = body

    // Ukládáme přímo s ověřeným user.id
    const { data, error } = await supabase
      .from('activities')
      .insert({
        title,
        user_id: user.id, // <--- Bezpečně svázáno s auth.uid()
        track_id: track_id || null,
        chainring: chainring ? parseInt(chainring) : null,
        cog: cog ? parseInt(cog) : null,
        crank_length_mm: crank_length_mm || 165.0,
        max_cadence_rpm: summary?.max_cadence_rpm ?? summary?.max_cadence ?? null,
        max_speed_kmh: summary?.max_speed_kmh ?? null,
        max_power_w: summary?.max_power_w ?? null,
        peak_torque_nm: summary?.peak_torque_nm ?? null,
        curves_data: curves ?? {},
        time_series: time_series ?? {},
        raw_file_url: raw_file_url ?? null,
        file_sha256: file_sha256 ?? null,
        processing_status: 'baseline_completed',
        activity_date: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Perzistujeme i jednotlivé durational curves do activity_curves (pro chart komponenty)
    if (curves && Object.keys(curves).length > 0) {
      const curveRows = Object.entries(curves).map(([curveType, curveData]) => ({
        activity_id: data.id,
        curve_type: curveType,
        data: curveData,
      }))
      await supabase.from('activity_curves').insert(curveRows)
    }

    return NextResponse.json({
      success: true,
      activity: data,
      summary,
      curves,
      time_series: time_series ?? {},
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

