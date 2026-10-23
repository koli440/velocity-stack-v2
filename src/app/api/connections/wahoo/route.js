import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { deauthorize, getFreshAccessToken } from '../../../../lib/server/wahooProvider'
import { parseBackfillDays } from '../../../../lib/connections'
import { isWahooConfigured } from '../../../../lib/wahoo'

export const dynamic = 'force-dynamic'

async function authed(req) {
  const { supabase, user } = await getRequestUser(req)
  return user ? { supabase, user } : null
}

// Whether Wahoo can be connected on this deployment (drives the "not configured" card state).
export async function GET() {
  return NextResponse.json({ configured: isWahooConfigured() && !!getServiceClient() })
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
      p_provider: 'wahoo',
      p_backfill_days: backfill.value,
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, backfillDays: backfill.value })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Disconnect: revoke access at Wahoo (best effort; this frees the token slot and removes our scheduled
// workouts/plans there), then clear the tokens and stop syncing.
export async function DELETE(req) {
  try {
    const ctx = await authed(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = getServiceClient()
    if (service) {
      const { data } = await service
        .from('connections')
        .select('user_id, access_token, refresh_token, token_expires_at')
        .eq('user_id', ctx.user.id)
        .eq('provider', 'wahoo')
        .maybeSingle()
      if (data?.refresh_token) {
        const token = await getFreshAccessToken(service, data).catch(() => data.access_token)
        await deauthorize(token)
      }
    }
    const { error } = await ctx.supabase.rpc('disconnect_connection', { p_provider: 'wahoo' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
