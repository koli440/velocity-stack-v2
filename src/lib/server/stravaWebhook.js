// src/lib/server/stravaWebhook.js
// Handling of Strava webhook events (#109 step 5). Events are not signed by Strava, so nothing here
// trusts the payload beyond "this athlete may have news": activity events only trigger our own
// authenticated sync, and deauthorization is verified against Strava before tokens are cleared.

import { getFreshAccessToken } from './stravaProvider.js'
import { parseWebhookEvent } from '../strava.js'

async function activeConnections(service, athleteId) {
  const { data, error } = await service
    .from('connections')
    .select('id, user_id, access_token, refresh_token, token_expires_at, last_attempt_at')
    .eq('provider', 'strava')
    .eq('external_athlete_id', athleteId)
    .neq('status', 'disconnected')
  if (error) throw error
  return data || []
}

/** True only when Strava itself says our access for this connection is gone. */
export async function isAccessRevoked(service, conn, { fetchImpl = fetch } = {}) {
  try {
    const token = await getFreshAccessToken(service, conn, { fetchImpl })
    const res = await fetchImpl('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    return res.status === 401
  } catch (err) {
    return err?.name === 'StravaAuthError'
  }
}

async function clearConnection(service, conn) {
  await service
    .from('connections')
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      status: 'disconnected',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id)
}

async function alreadyImported(service, userId, activityId) {
  const { data } = await service
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('external_source', 'strava')
    .eq('external_id', activityId)
    .limit(1)
  return !!data?.length
}

/**
 * Process one parsed event body.
 * `triggerSync(userId)` starts a Strava sync for that rider (see the webhook route).
 * @returns {Promise<{ handled: string }>}
 */
export async function handleStravaEvent(service, body, { triggerSync, fetchImpl = fetch } = {}) {
  const event = parseWebhookEvent(body)
  if (event.kind === 'ignore') return { handled: 'ignored' }

  const conns = await activeConnections(service, event.athleteId)
  if (!conns.length) return { handled: 'unknown_athlete' }

  if (event.kind === 'deauthorized') {
    let cleared = 0
    for (const conn of conns) {
      if (await isAccessRevoked(service, conn, { fetchImpl })) {
        await clearConnection(service, conn)
        cleared++
      }
    }
    return { handled: cleared ? 'deauthorized' : 'deauthorization_unverified' }
  }

  // Deleting an activity on Strava never removes it from the vault.
  if (event.aspect === 'delete') return { handled: 'ignored' }

  let triggered = 0
  for (const conn of conns) {
    if (await alreadyImported(service, conn.user_id, event.activityId)) continue
    // Make the connection due (sync claims it by last_attempt_at) and run it right away.
    await service.from('connections').update({ last_attempt_at: null }).eq('id', conn.id)
    await triggerSync?.(conn.user_id)
    triggered++
  }
  return { handled: triggered ? 'sync_triggered' : 'already_imported' }
}
