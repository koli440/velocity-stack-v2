// src/lib/server/intervalsWebhook.js
// Handling of Intervals.icu webhook events (#316). Authenticity is the shared secret (checked by the route); events only
// trigger our own authenticated sync/push, so nothing in the payload is imported directly. Everything is idempotent:
// repeated deliveries just make the rider due again.

import { athleteIdVariants, isOwnCalendarEcho, parseIntervalsEvents, scopeLost, SCOPE_REVOKED_ERROR } from '../intervalsWebhook.js'

async function activeConnections(service, athleteId) {
  const { data, error } = await service
    .from('connections')
    .select('id, user_id, access_token, push_planned_workouts')
    .eq('provider', 'intervals')
    .in('external_athlete_id', athleteIdVariants(athleteId))
    .neq('status', 'disconnected')
  if (error) throw error
  return data || []
}

/**
 * Process one webhook body. `triggerSync(userId)` starts that rider's Intervals.icu sync, `triggerPush()` the planned push run.
 * ACTIVITY_DELETED only triggers a sync: imported rides are never deleted (same policy as Strava).
 * @returns {Promise<{ handled: Record<string, number> }>}
 */
export async function handleIntervalsWebhook(service, body, { triggerSync, triggerPush } = {}) {
  const handled = {}
  const count = (k) => { handled[k] = (handled[k] || 0) + 1 }
  const syncUsers = new Set()
  let push = false

  for (const event of parseIntervalsEvents(body)) {
    const conns = await activeConnections(service, event.athlete_id)
    if (!conns.length) { count('unknown_athlete'); continue }

    if (event.type === 'ACTIVITY_UPLOADED' || event.type === 'ACTIVITY_UPDATED' || event.type === 'ACTIVITY_DELETED') {
      for (const c of conns) {
        await service.from('connections').update({ last_attempt_at: null }).eq('id', c.id)
        syncUsers.add(c.user_id)
      }
      count('sync')
    } else if (event.type === 'CALENDAR_UPDATED') {
      if (isOwnCalendarEcho(event)) { count('own_echo'); continue }
      const riders = conns.filter((c) => c.push_planned_workouts)
      for (const c of riders) await service.from('connections').update({ planned_push_attempt_at: null }).eq('id', c.id)
      if (riders.length) push = true
      count('calendar')
    } else if (event.type === 'APP_SCOPE_CHANGED') {
      if (!scopeLost(event)) { count('scope_ok'); continue }
      for (const c of conns.filter((x) => x.access_token)) {
        await service.from('connections').update({ status: 'error', last_error: SCOPE_REVOKED_ERROR }).eq('id', c.id)
      }
      count('scope_changed')
    } else {
      count('ignored')
    }
  }

  for (const userId of syncUsers) await triggerSync?.(userId)
  if (push) await triggerPush?.()
  return { handled }
}
