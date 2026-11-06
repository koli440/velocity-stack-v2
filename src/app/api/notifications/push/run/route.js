// POST /api/notifications/push/run: pushes unread notifications to the recipient's devices. Called by the
// notifications trigger and a 1-minute pg_cron safety net (x-sync-token, see 20270137000000_web_push.sql).
// No-op without VAPID keys.

import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { isCronToken } from '../../../../../lib/server/syncRoute'
import { pushEnabled, sendToSubscriptions } from '../../../../../lib/server/webPush'
import { withCoachContext, profileName } from '../../../../../lib/notificationEmail'
import { buildPushPayload, isPushStale } from '../../../../../lib/push'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BATCH = 50

export async function POST(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (!(await isCronToken(service, req.headers.get('x-sync-token')))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!pushEnabled()) return NextResponse.json({ skipped: 'no vapid keys' })

  const { data: rows } = await service
    .from('notifications')
    .select('id, user_id, actor_id, type, activity_id, suggestion_id, event_count, created_at')
    .is('pushed_at', null)
    .is('read_at', null)
    .order('created_at')
    .limit(BATCH)

  let sent = 0
  for (const n of rows || []) {
    // Claim first so overlapping runs never double-send.
    const { data: claimed } = await service
      .from('notifications')
      .update({ pushed_at: new Date().toISOString() })
      .eq('id', n.id)
      .is('pushed_at', null)
      .select('id')
    if (!claimed?.length || isPushStale(n.created_at)) continue
    try {
      const { data: subs } = await service
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', n.user_id)
      if (!subs?.length) continue
      let actor = null
      if (n.actor_id) {
        const { data } = await service.from('profiles').select('nickname, first_name, last_name').eq('id', n.actor_id).maybeSingle()
        actor = data ? { display_name: profileName(data) } : null
      }
      sent += await sendToSubscriptions(service, subs, buildPushPayload(await withCoachContext(service, n), actor))
    } catch (e) {
      console.error('notification push failed', n.id, e?.message)
    }
  }
  return NextResponse.json({ sent, checked: rows?.length || 0 })
}
