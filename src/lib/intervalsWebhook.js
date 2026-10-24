// src/lib/intervalsWebhook.js
// Pure helpers for Intervals.icu webhooks (#316). Payload: { secret, events: [{ athlete_id, type, timestamp, ... }] }.
// The shared secret arrives in the body `secret`; the configured "Webhook Authorization Header" is accepted as well.

import { matchesWebhookToken } from './wahoo.js'

export const OUR_EXTERNAL_ID_PREFIX = 'velocity-stack:'
export const SCOPE_REVOKED_ERROR = 'Intervals.icu permissions changed. Reconnect Intervals.icu to keep syncing.'
export const REQUIRED_SCOPE = 'ACTIVITY:'

/** True when the body secret or the Authorization header (raw or "Bearer ...") matches the configured token. */
export function isAuthorizedWebhook({ bodySecret, authorization }, expected) {
  if (matchesWebhookToken(bodySecret, expected)) return true
  if (typeof authorization !== 'string') return false
  const value = authorization.trim()
  return matchesWebhookToken(value, expected) || matchesWebhookToken(value.replace(/^bearer\s+/i, ''), expected)
}

/** Normalised events: only objects with a string/number athlete_id and a string type. */
export function parseIntervalsEvents(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) return []
  return body.events
    .filter((e) => e && typeof e === 'object' && typeof e.type === 'string' && e.athlete_id != null && e.athlete_id !== '')
    .map((e) => ({ ...e, athlete_id: String(e.athlete_id) }))
}

/** Athlete ids as stored on connections (normalizeIntervalsAthleteId adds the `i` prefix for API-key riders). */
export function athleteIdVariants(id) {
  const s = String(id).trim()
  const bare = s.replace(/^i/i, '')
  return [...new Set([s, bare, `i${bare}`])]
}

/** A CALENDAR_UPDATED event that only echoes our own pushes (all events carry our external_id, nothing deleted). */
export function isOwnCalendarEcho(event) {
  const events = Array.isArray(event.events) ? event.events : []
  const deleted = Array.isArray(event.deleted_events) ? event.deleted_events : []
  if (deleted.length || !events.length) return false
  return events.every((e) => typeof e?.external_id === 'string' && e.external_id.startsWith(OUR_EXTERNAL_ID_PREFIX))
}

/** APP_SCOPE_CHANGED: whether activity read access is gone. Unknown scope info is treated as "changed" (rider reconnects). */
export function scopeLost(event) {
  const raw = event.scope ?? event.scopes
  const list = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : null
  if (list == null) return true
  return !list.split(',').some((s) => s.trim().toUpperCase().startsWith(REQUIRED_SCOPE))
}
