// src/lib/server/garminWebhook.js
// Handling of Garmin push notifications (#310). The endpoint URL carries a shared token (checked by the route);
// payloads are only acted on for Garmin user ids that belong to one of our active connections, and an activity
// event only queues the file for our own authenticated sync, so nothing in the payload is imported directly.

import { classifyGarminActivityType, isGarminHost, parseGarminPush, permissionFlags, NO_ACTIVITY_PERMISSION_MESSAGE, NO_WORKOUT_PERMISSION_MESSAGE } from '../garmin.js'

async function activeConnections(service, garminUserId) {
  const { data, error } = await service
    .from('connections')
    .select('id, user_id, last_error, planned_push_error')
    .eq('provider', 'garmin')
    .eq('external_athlete_id', garminUserId)
    .neq('status', 'disconnected')
  if (error) throw error
  return data || []
}

/** Rider removed our access at Garmin: same effect as Disconnect (tokens cleared, push mappings reset by trigger). */
async function handleDeregistration(service, conns) {
  for (const conn of conns) {
    await service
      .from('connections')
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        external_athlete_id: null,
        status: 'disconnected',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conn.id)
    await service.from('garmin_activity_events').delete().eq('user_id', conn.user_id).eq('status', 'pending')
  }
}

/** Rider changed what Garmin shares with us: surface missing permissions, clear the notes once restored. */
async function handlePermissions(service, conns, permissions) {
  const flags = permissionFlags(permissions)
  for (const conn of conns) {
    const patch = {}
    if (!flags.activities) patch.last_error = NO_ACTIVITY_PERMISSION_MESSAGE
    else if (conn.last_error === NO_ACTIVITY_PERMISSION_MESSAGE) patch.last_error = null
    if (!flags.workouts) patch.planned_push_error = NO_WORKOUT_PERMISSION_MESSAGE
    else if (conn.planned_push_error === NO_WORKOUT_PERMISSION_MESSAGE) patch.planned_push_error = null
    if (Object.keys(patch).length) await service.from('connections').update(patch).eq('id', conn.id)
  }
}

/**
 * Process one parsed push body. `triggerSync(userId)` starts a Garmin sync for that rider (see the webhook route).
 * @returns {Promise<{ activities: number, deregistrations: number, permissions: number, ignored: number }>}
 */
export async function handleGarminPush(service, body, { triggerSync, log = console.info } = {}) {
  const out = { activities: 0, deregistrations: 0, permissions: 0, ignored: 0 }
  const toSync = new Set()
  const events = parseGarminPush(body)
  const keys = body && typeof body === 'object' ? Object.keys(body) : []
  const raw = Array.isArray(body?.activityFiles) ? body.activityFiles.length : 0
  log(`Garmin push: types=[${keys.join(',')}] parsed=${events.length} activityFiles=${raw}`)
  for (const event of events) {
    const conns = await activeConnections(service, event.userId)
    if (!conns.length) {
      log(`Garmin push: ignored ${event.kind} (no active connection for this Garmin user)`)
      out.ignored++
      continue
    }
    if (event.kind === 'deregistration') {
      await handleDeregistration(service, conns)
      log('Garmin push: processed deregistration')
      out.deregistrations++
    } else if (event.kind === 'permissions') {
      await handlePermissions(service, conns, event.permissions)
      log('Garmin push: processed permission change')
      out.permissions++
    } else if (event.kind === 'activity_file') {
      // The push names the sport, so sports we never import are not queued: the file URL is single-use.
      if (!isGarminHost(event.callbackUrl) || classifyGarminActivityType(event.activityType) === 'skip') {
        log(`Garmin push: ignored activity ${event.summaryId} (${isGarminHost(event.callbackUrl) ? `type ${event.activityType} is not imported` : 'unexpected callback host'})`)
        out.ignored++
        continue
      }
      for (const conn of conns) {
        // Duplicate pushes (retries) keep the first row, so a settled activity is never queued again.
        const { error } = await service.from('garmin_activity_events').upsert(
          {
            user_id: conn.user_id,
            summary_id: event.summaryId,
            callback_url: event.callbackUrl,
            start_time_s: event.startSeconds,
            start_offset_s: event.offsetSeconds,
            status: 'pending',
          },
          { onConflict: 'user_id,summary_id', ignoreDuplicates: true }
        )
        if (error) throw error
        toSync.add(conn.user_id)
        // Make the connection due (sync claims it by last_attempt_at).
        await service.from('connections').update({ last_attempt_at: null }).eq('id', conn.id)
      }
      log(`Garmin push: queued activity ${event.summaryId} type=${event.activityType ?? 'unknown'} for ${conns.length} connection(s)`)
      out.activities++
    }
  }
  for (const userId of toSync) await triggerSync?.(userId)
  log(`Garmin push: done activities=${out.activities} deregistrations=${out.deregistrations} permissions=${out.permissions} ignored=${out.ignored}`)
  return out
}
