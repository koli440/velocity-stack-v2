// src/lib/syncPlan.js
// Pure helpers for the automatic Intervals.icu sync (#109 step 4).

import { backfillOldest } from './connections.js'
import { findDuplicate, resolveDuplicate } from './activityDuplicates.js'

export const SYNC_OVERLAP_DAYS = 2
export const MANUAL_SYNC_COOLDOWN_S = 60
export const CRON_MIN_INTERVAL_S = 600

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

/** Listed rides not yet imported from this source, oldest first (so the cursor advances monotonically). */
export function selectNewRides(rides, existing = [], source = 'intervals') {
  const known = new Set(
    existing.filter((e) => e.external_source === source && e.external_id != null).map((e) => String(e.external_id))
  )
  return (Array.isArray(rides) ? rides : [])
    .filter((r) => r?.id != null && !known.has(String(r.id)))
    // Rides carrying start_time/elapsed_time_s (Strava list) that duplicate a same-or-higher priority
    // copy (e.g. already imported from Intervals.icu) would only be skipped after an expensive fetch.
    .filter((r) => {
      if (!r.start_time || r.elapsed_time_s == null) return true
      const dup = findDuplicate({ startTime: r.start_time, elapsedTimeS: r.elapsed_time_s }, existing)
      return !dup || resolveDuplicate({ source }, dup) === 'upgrade'
    })
    .sort((a, b) => String(a.start_date_local || '').localeCompare(String(b.start_date_local || '')))
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

/** Summary line for the UI after a manual sync. */
export function describeSyncResult(r) {
  if (!r) return ''
  if (r.error) return r.error
  const parts = []
  if (r.imported) parts.push(`${r.imported} imported`)
  if (r.upgraded) parts.push(`${r.upgraded} upgraded`)
  if (r.skipped) parts.push(`${r.skipped} already there`)
  if (r.failed) parts.push(`${r.failed} failed`)
  if (!parts.length) return 'Up to date'
  return parts.join(', ') + (r.complete === false ? ' (more to come)' : '')
}
