import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { deauthorize, getFreshAccessToken } from '../../../../lib/server/garminProvider'
import { isGarminConfigured } from '../../../../lib/garmin'

export const dynamic = 'force-dynamic'

// Whether Garmin can be connected on this deployment (drives the "not configured" card state).
export async function GET() {
  return NextResponse.json({ configured: isGarminConfigured() && !!getServiceClient() })
}

// Disconnect: remove our registration at Garmin (best effort, stops pushes), then clear tokens and stop syncing.
// There is no backfill setting: Garmin Starter only sends new activities.
export async function DELETE(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = getServiceClient()
    if (service) {
      const { data } = await service
        .from('connections')
        .select('user_id, access_token, refresh_token, token_expires_at')
        .eq('user_id', user.id)
        .eq('provider', 'garmin')
        .maybeSingle()
      if (data?.refresh_token) {
        const token = await getFreshAccessToken(service, data).catch(() => data.access_token)
        await deauthorize(token)
      }
      await service.from('garmin_activity_events').delete().eq('user_id', user.id)
    }
    const { error } = await supabase.rpc('disconnect_connection', { p_provider: 'garmin' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
