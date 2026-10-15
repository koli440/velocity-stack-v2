import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { validateIntervalsCredentials } from '../../../../lib/server/intervalsProvider'
import { ImportError } from '../../../../lib/server/importErrors'
import { parseBackfillDays, normalizeIntervalsAthleteId } from '../../../../lib/connections'

async function authed(req) {
  const { supabase, user } = await getRequestUser(req)
  return user ? { supabase, user } : null
}

function fail(err) {
  const status = err instanceof ImportError ? err.status : 500
  return NextResponse.json({ error: err.message }, { status })
}

// Connect: validates the key against Intervals.icu, then stores it (write-only for the client).
export async function POST(req) {
  try {
    const ctx = await authed(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabase, user } = ctx
    const body = await req.json()

    const athleteId = normalizeIntervalsAthleteId(body.athleteId)
    const apiKey = String(body.apiKey ?? '').trim()
    const backfill = parseBackfillDays(body.backfillDays)
    if (!backfill.ok) return NextResponse.json({ error: backfill.error }, { status: 400 })

    await validateIntervalsCredentials({ athleteId, apiKey })

    const { error } = await supabase.rpc('connect_intervals', {
      p_athlete_id: athleteId,
      p_api_key: apiKey,
      p_backfill_days: backfill.value,
    })
    if (error) throw new ImportError(error.message, 500)

    // Without a service-role key the server can only read secrets through the legacy row.
    if (!getServiceClient()) {
      const { error: legacyErr } = await supabase.from('profile_secrets').upsert({
        user_id: user.id,
        intervals_athlete_id: athleteId,
        intervals_api_key: apiKey,
        updated_at: new Date().toISOString(),
      })
      if (legacyErr) throw new ImportError(legacyErr.message, 500)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return fail(err)
  }
}

// Update the backfill window (null = full history).
export async function PATCH(req) {
  try {
    const ctx = await authed(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const backfill = parseBackfillDays(body.backfillDays)
    if (!backfill.ok || body.backfillDays === undefined) {
      return NextResponse.json({ error: backfill.error || 'backfillDays is required' }, { status: 400 })
    }
    const { error } = await ctx.supabase.rpc('set_connection_backfill', {
      p_provider: 'intervals',
      p_backfill_days: backfill.value,
    })
    if (error) throw new ImportError(error.message, 500)
    return NextResponse.json({ success: true, backfillDays: backfill.value })
  } catch (err) {
    return fail(err)
  }
}

// Disconnect: clears the stored credentials and stops syncing.
export async function DELETE(req) {
  try {
    const ctx = await authed(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { error } = await ctx.supabase.rpc('disconnect_connection', { p_provider: 'intervals' })
    if (error) throw new ImportError(error.message, 500)
    return NextResponse.json({ success: true })
  } catch (err) {
    return fail(err)
  }
}

export const dynamic = 'force-dynamic'
