// src/lib/syncPlan.js
// Pure helpers for the automatic Intervals.icu sync (#109 step 4).

import { backfillOldest } from './connections.js'
import { findDuplicate, resolveDuplicate } from './activityDuplicates.js'

export const SYNC_OVERLAP_DAYS = 2
export const MANUAL_SYNC_COOLDOWN_S = 60
export const CRON_MIN_INTERVAL_S = 600
// A run that chains straight into the next one only needs to avoid re-claiming a connection that is still running.
export const CHAIN_MIN_INTERVAL_S = 3
export const MAX_CHAIN_DEPTH = 20
export const STRAVA_BACKFILL_TURN = 10

function dateOnly(d) {
  return d.toISOString().split('T')[0]
}

/**
 * Lower bound (YYYY-MM-DD) for listing activities. First run (no cursor): the backfill window.
 * Later runs: the cursor minus a small overlap so late-arriving rides aren't missed.
 */
export function syncWindowStart({ lastSyncedAt, backfillDays, now = new Date() }) {
  if (!lastSyncedAt) return backfillOldest(backfillDays, now)
  const cursor = new Date(lastSyncedAt)
  if (Number.isNaN(cursor.getTime())) return backfillOldest(backfillDays, now)
  cursor.setUTCDate(cursor.getUTCDate() - SYNC_OVERLAP_DAYS)
  return dateOnly(cursor)
}

/** Start time of a listed ride in ms: the real UTC start (Strava) or the local start read as UTC (Intervals.icu). */
export function rideTimeMs(ride) {
  const raw = ride?.start_time || ride?.start_date_local
  if (!raw) return NaN
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`
  return new Date(s).getTime()
}

/** Same instant as an ISO string, or null. */
export function rideTimeIso(ride) {
  const t = rideTimeMs(ride)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Newest ride first (rides without a usable time last). Does not mutate the input. */
export function newestFirst(rides) {
  const t = (r) => {
    const v = rideTimeMs(r)
    return Number.isNaN(v) ? -Infinity : v
  }
  return [...(rides || [])].sort((a, b) => t(b) - t(a))
}

/**
 * Listed rides not yet imported from this source, newest first (so riders see recent history immediately
 * and the backfill cursor only ever moves backwards in time).
 */
export function selectNewRides(rides, existing = [], source = 'intervals') {
  const known = new Set(
    existing.filter((e) => e.external_source === source && e.external_id != null).map((e) => String(e.external_id))
  )
  const filtered = (Array.isArray(rides) ? rides : [])
    .filter((r) => r?.id != null && !known.has(String(r.id)))
    // Rides carrying start_time/elapsed_time_s (Strava list) that duplicate a same-or-higher priority
    // copy (e.g. already imported from Intervals.icu) would only be skipped after an expensive fetch.
    .filter((r) => {
      if (!r.start_time || r.elapsed_time_s == null) return true
      const dup = findDuplicate({ startTime: r.start_time, elapsedTimeS: r.elapsed_time_s }, existing)
      return !dup || resolveDuplicate({ source }, dup) === 'upgrade'
    })
  return newestFirst(filtered)
}

/** Auth failures are fatal (status 'error' until the user reconnects); everything else is retried. */
export function classifySyncError(err, provider = 'intervals') {
  const status = err?.status
  if (provider === 'strava') {
    const fatal = err?.fatal === true || status === 401
    return { fatal, message: fatal ? String(err?.message || 'Strava rejected the connection. Reconnect Strava.').slice(0, 300) : String(err?.message || 'Sync failed').slice(0, 300) }
  }
  const fatal = status === 401 || status === 403 || status === 404
  const message = fatal
    ? 'Intervals.icu rejected the API key. Reconnect with a valid key.'
    : String(err?.message || 'Sync failed').slice(0, 300)
  return { fatal, message }
}

export const PROVIDER_LABELS = { intervals: 'Intervals.icu', strava: 'Strava' }

/** Connections the cron should process now: active, not attempted recently, least recently tried first.
 *  Credentials: an Intervals api_key or a Strava refresh_token. */
export function pickDueConnections(rows, { now = new Date(), minIntervalS = CRON_MIN_INTERVAL_S, limit = 10 } = {}) {
  const cutoff = now.getTime() - minIntervalS * 1000
  return (rows || [])
    .filter((r) => r.status === 'active' && (r.api_key || r.refresh_token) && r.external_athlete_id)
    .filter((r) => !r.last_attempt_at || new Date(r.last_attempt_at).getTime() <= cutoff)
    .sort((a, b) => (a.last_attempt_at ? new Date(a.last_attempt_at).getTime() : 0) - (b.last_attempt_at ? new Date(b.last_attempt_at).getTime() : 0))
    .slice(0, limit)
}

/** Seconds the caller must still wait before a manual sync, or 0. */
export function manualCooldownRemaining(lastAttemptAt, now = new Date(), cooldownS = MANUAL_SYNC_COOLDOWN_S) {
  if (!lastAttemptAt) return 0
  const elapsed = (now.getTime() - new Date(lastAttemptAt).getTime()) / 1000
  return elapsed >= cooldownS ? 0 : Math.ceil(cooldownS - elapsed)
}

/** Summary line for the UI after a manual sync (counts first, then why it stopped, if it did). */
export function describeSyncResult(r) {
  if (!r) return ''
  const parts = []
  if (r.imported) parts.push(`${r.imported} imported`)
  if (r.upgraded) parts.push(`${r.upgraded} upgraded`)
  if (r.skipped) parts.push(`${r.skipped} already there`)
  if (r.failed) parts.push(`${r.failed} failed`)
  const counts = parts.join(', ')
  if (r.error) return counts ? `${counts}. ${r.error}` : r.error
  if (!counts) return 'Up to date'
  return counts + (r.complete === false ? ' (more to come)' : '')
}

/** Backfill window of a connection: lower date bound and the upper bound (the cursor) to resume from.
 *  Without a forward cursor (first run, reconnect) the backfill starts again from the newest ride. */
export function backfillBounds(conn, now = new Date()) {
  const restart = !conn?.last_synced_at || !conn?.backfill_cursor
  return {
    oldest: backfillOldest(conn?.backfill_days ?? null, now),
    before: restart ? null : new Date(conn.backfill_cursor).toISOString(),
  }
}

/** Does this connection still have history to import? */
export function needsBackfill(conn) {
  return !conn?.last_synced_at || !conn?.backfill_complete
}

/**
 * New backfill cursor after one listing was handled.
 * @param {{ todo: object[], handled: number, exhausted: boolean, nextBefore: string|null, current: string|null }} p
 * @returns {{ cursor: string|null, complete: boolean }} cursor = everything newer than it is done
 */
export function advanceBackfillCursor({ todo, handled, exhausted, nextBefore, current }) {
  if (handled < todo.length) {
    // Stopped part-way: resume at the oldest ride handled so far.
    const last = handled > 0 ? rideTimeIso(todo[handled - 1]) : null
    return { cursor: last || current || null, complete: false }
  }
  if (exhausted) return { cursor: current || null, complete: true }
  // Whole listing handled but older rides remain: continue from where the listing ended.
  const next = nextBefore || (todo.length ? rideTimeIso(todo[todo.length - 1]) : null)
  return { cursor: next || current || null, complete: false }
}

/** Rides one Strava rider may backfill in a turn: an equal share of what is left, at most `cap`. Round-robin
 *  (least recently attempted first) plus this cap keeps one rider from starving the others. */
export function backfillTurnSize({ remaining, riders = 1, cap = STRAVA_BACKFILL_TURN }) {
  if (!(remaining > 0)) return 0
  return Math.max(1, Math.min(cap, Math.floor(remaining / Math.max(1, riders))))
}

/** Should a finished run immediately start the next one? Only while there is progress and the chain is short. */
export function shouldChain({ results, depth = 0, provider, budgetLeft = true, maxDepth = MAX_CHAIN_DEPTH }) {
  if (depth >= maxDepth) return false
  const active = (results || []).filter((r) => r.more && !r.fatal)
  if (!active.length) return false
  if (!active.some((r) => r.handled > 0)) return false
  if (provider === 'strava' && !budgetLeft) return false
  return true
}

/** Progress line for a connection card while history is still being imported; null otherwise. */
export function backfillProgressText(conn) {
  if (!conn || conn.status === 'disconnected' || conn.backfill_complete !== false) return null
  const done = Number(conn.backfill_imported) || 0
  const total = Number(conn.backfill_total) || 0
  const back = conn.backfill_cursor
    ? ` (back to ${new Date(conn.backfill_cursor).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })})`
    : ''
  if (total > 0) return `Importing history, newest first: ${Math.min(done, total)} of ${total} rides${back}`
  return done > 0 ? `Importing history, newest first: ${done} rides so far${back}` : 'Importing history, newest first'
}
