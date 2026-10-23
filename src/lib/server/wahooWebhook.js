// src/lib/server/wahooWebhook.js
// Handling of Wahoo webhook events (#311). Authenticity is the shared webhook_token (checked by the route); the
// event only triggers our own authenticated sync, so nothing in the payload is imported directly.

import { parseWebhookEvent } from '../wahoo.js'

async function activeConnections(service, wahooUserId) {
  const { data, error } = await service
    .from('connections')
    .select('id, user_id')
    .eq('provider', 'wahoo')
    .eq('external_athlete_id', wahooUserId)
    .neq('status', 'disconnected')
  if (error) throw error
  return data || []
}

async function alreadyImported(service, userId, workoutId) {
  const { data } = await service
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('external_source', 'wahoo')
    .eq('external_id', workoutId)
    .limit(1)
  return !!data?.length
}

/**
 * Process one parsed event body. `triggerSync(userId)` starts a Wahoo sync for that rider (see the webhook route).
 * Wahoo can send duplicates (file updated/deleted), so a known workout id does not start another sync.
 * @returns {Promise<{ handled: string }>}
 */
export async function handleWahooEvent(service, body, { triggerSync } = {}) {
  const event = parseWebhookEvent(body)
  if (event.kind === 'ignore') return { handled: 'ignored' }

  const conns = await activeConnections(service, event.userId)
  if (!conns.length) return { handled: 'unknown_user' }

  let triggered = 0
  for (const conn of conns) {
    if (event.workoutId && (await alreadyImported(service, conn.user_id, event.workoutId))) continue
    // Make the connection due (sync claims it by last_attempt_at) and run it right away.
    await service.from('connections').update({ last_attempt_at: null }).eq('id', conn.id)
    await triggerSync?.(conn.user_id)
    triggered++
  }
  return { handled: triggered ? 'sync_triggered' : 'already_imported' }
}
