// POST /api/notifications/email/run: emails riders about unread notifications. Called by pg_cron
// (x-sync-token, see 20261222000000_notification_emails.sql). No-op without RESEND_API_KEY.

import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { isCronToken } from '../../../../../lib/server/syncRoute'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { buildNotificationEmail, sendEmail, profileName, withCoachContext } from '../../../../../lib/notificationEmail'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BATCH = 50

export async function POST(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (!(await isCronToken(service, req.headers.get('x-sync-token')))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ skipped: 'no mail provider' })

  const origin = appOrigin(req)
  const { data: rows } = await service
    .from('notifications')
    .select('id, user_id, actor_id, type, activity_id, suggestion_id, created_at')
    .is('emailed_at', null)
    .is('read_at', null)
    .order('created_at')
    .limit(BATCH)

  let sent = 0
  for (const n of rows || []) {
    // Claim first so overlapping runs never double-send.
    const { data: claimed } = await service
      .from('notifications')
      .update({ emailed_at: new Date().toISOString() })
      .eq('id', n.id)
      .is('emailed_at', null)
      .select('id')
    if (!claimed?.length) continue
    try {
      const { data: recipient } = await service
        .from('profiles')
        .select('email_notifications')
        .eq('id', n.user_id)
        .maybeSingle()
      if (recipient?.email_notifications === false) continue
      const { data: auth } = await service.auth.admin.getUserById(n.user_id)
      const to = auth?.user?.email
      if (!to) continue
      let actor = null
      if (n.actor_id) {
        const { data } = await service
          .from('profiles')
          .select('nickname, first_name, last_name')
          .eq('id', n.actor_id)
          .maybeSingle()
        actor = data
      }
      await sendEmail({ to, ...buildNotificationEmail(await withCoachContext(service, n), actor, origin) })
      sent++
    } catch (e) {
      console.error('notification email failed', n.id, e?.message)
    }
  }
  return NextResponse.json({ sent, checked: rows?.length || 0 })
}
