// src/lib/connections.js
// Pure helpers shared by the connections API routes, the sync route and the settings UI.

export const DEFAULT_BACKFILL_DAYS = 30
export const MAX_BACKFILL_DAYS = 36500

// Non-secret columns clients may select from public.connections.
export const CONNECTION_PUBLIC_COLUMNS =
  'id, provider, external_athlete_id, status, last_error, last_synced_at, backfill_days, backfill_cursor, backfill_complete, backfill_imported, backfill_total, auth_method'

/**
 * Validate a backfill setting. `undefined` => default (30), `null`/'full' => full history (null).
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
export function parseBackfillDays(input) {
  if (input === undefined) return { ok: true, value: DEFAULT_BACKFILL_DAYS }
  if (input === null || input === 'full') return { ok: true, value: null }
  const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_BACKFILL_DAYS) {
    return { ok: false, error: `backfillDays must be a whole number between 1 and ${MAX_BACKFILL_DAYS}, or null for full history` }
  }
  return { ok: true, value: n }
}

/** YYYY-MM-DD lower bound for the list window, or undefined for full history. */
export function backfillOldest(backfillDays, now = new Date()) {
  if (backfillDays === null) return undefined
  const days = Number.isInteger(backfillDays) && backfillDays > 0 ? backfillDays : DEFAULT_BACKFILL_DAYS
  const since = new Date(now.getTime())
  since.setUTCDate(since.getUTCDate() - days)
  return since.toISOString().split('T')[0]
}

/** Normalise an Intervals athlete id typed by a user ("228280" / " i228280 " -> "i228280"). */
export function normalizeIntervalsAthleteId(raw) {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  return /^\d+$/.test(v) ? `i${v}` : v
}

/** Human label for a connection row. */
export function connectionStatusLabel(conn) {
  if (!conn || conn.status === 'disconnected') return 'Not connected'
  if (conn.status === 'error') return 'Needs attention'
  return 'Connected'
}

export function isConnected(conn) {
  return !!conn && conn.status !== 'disconnected'
}

export const STALE_SYNC_MINUTES = 60

/**
 * Sync-health indicator for a connected row: { level: 'ok'|'warn'|'error', text } or null when not connected.
 * Cron runs every 15 minutes, so an active connection that has not synced for an hour is flagged.
 */
export function syncHealth(conn, now = new Date()) {
  if (!isConnected(conn)) return null
  if (conn.status === 'error') return { level: 'error', text: 'Sync stopped' }
  if (!conn.last_synced_at) return { level: 'warn', text: 'Waiting for the first sync' }
  const ageMin = (now.getTime() - new Date(conn.last_synced_at).getTime()) / 60000
  if (Number.isNaN(ageMin)) return { level: 'warn', text: 'Waiting for the first sync' }
  if (ageMin > STALE_SYNC_MINUTES) return { level: 'warn', text: 'Sync looks delayed' }
  return { level: 'ok', text: 'Syncing normally' }
}
