// Server-side Web Push sender. Needs VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_SUBJECT
// (hosting env settings); without them pushEnabled() is false and callers no-op.

import webpush from 'web-push'
import { PUSH_TTL_S } from '../push.js'

export function pushEnabled(env = process.env) {
  return !!(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

function configure(env = process.env) {
  const subject = env.VAPID_SUBJECT || 'mailto:noreply@velocitystack.app'
  webpush.setVapidDetails(subject, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
}

// Sends one payload to each stored subscription; removes the ones the push service reports gone (404/410).
export async function sendToSubscriptions(service, subs, payload, { send = webpush.sendNotification } = {}) {
  configure()
  const body = JSON.stringify(payload)
  let delivered = 0
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: PUSH_TTL_S, urgency: 'normal' })
      delivered++
      await service.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id)
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await service.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        console.error('web push failed', e?.statusCode, e?.message)
      }
    }
  }
  return delivered
}
