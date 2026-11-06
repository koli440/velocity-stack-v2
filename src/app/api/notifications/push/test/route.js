// POST /api/notifications/push/test: sends a test notification to the signed-in caller's own devices.

import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { pushEnabled, sendToSubscriptions } from '../../../../../lib/server/webPush'
import { testPushPayload } from '../../../../../lib/push'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const service = getServiceClient()
  if (!service || !pushEnabled()) return NextResponse.json({ error: 'Push is not configured on this server' }, { status: 503 })
  const { data: subs } = await service.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user.id)
  if (!subs?.length) return NextResponse.json({ error: 'No device is subscribed' }, { status: 404 })
  const sent = await sendToSubscriptions(service, subs, testPushPayload())
  return NextResponse.json({ sent })
}
