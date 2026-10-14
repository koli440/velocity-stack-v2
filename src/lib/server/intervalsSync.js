// src/lib/server/intervalsSync.js
// Background Intervals.icu sync for one or more connections (#109 step 4). Runs with the service client.
// Bounded per invocation (fetch cap per connection + wall-clock deadline); unfinished work resumes on the
// next run through the cursor stored in connections.last_synced_at. One failing connection never blocks others.

import { createIntervalsProvider } from './intervalsProvider.js'
import { importActivity, loadImportProfile } from './importActivity.js'
import { loadExistingActivityFingerprints } from '../activityDuplicates.js'
import { selectNewRides, syncWindowStart, classifySyncError } from '../syncPlan.js'

export const MAX_FETCHES_PER_CONNECTION = 8

function toIso(localDate, fallback) {
  if (!localDate) return fallback
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(localDate) ? localDate : `${localDate}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString()
}

/**
 * Sync a single connection row {user_id, external_athlete_id, api_key, backfill_days, last_synced_at}.
 * Never throws; returns counters plus `error`/`fatal` when it stopped early.
 */
export async function syncConnection(service, conn, deps = {}) {
  const {
    analyzeFit,
    now = () => new Date(),
    deadline = Infinity,
    maxFetches = MAX_FETCHES_PER_CONNECTION,
    createProvider = createIntervalsProvider,
    importFn = importActivity,
  } = deps
  const startedAt = now()
  const result = { userId: conn.user_id, imported: 0, upgraded: 0, skipped: 0, failed: 0, complete: true }
  let cursor = null
  let fatalMessage = null
  let softMessage = null

  try {
    const provider = createProvider({ athleteId: conn.external_athlete_id, apiKey: conn.api_key })
    const oldest = syncWindowStart({
      lastSyncedAt: conn.last_synced_at,
      backfillDays: conn.backfill_days,
      now: startedAt,
    })
    const listed = await provider.listActivities({ oldest })
    const existing = await loadExistingActivityFingerprints(service, conn.user_id)
    const todo = selectNewRides(listed, existing, provider.source)
    const profile = await loadImportProfile(service, conn.user_id)

    let fetches = 0
    for (const ride of todo) {
      if (fetches >= maxFetches || Date.now() >= deadline) {
        result.complete = false
        break
      }
      fetches++
      try {
        const out = await importFn({
          supabase: service,
          userId: conn.user_id,
          provider,
          externalId: ride.id,
          options: { title: ride.name || undefined },
          analyzeFit,
          profile,
        })
        if (out.status === 'imported') result.imported++
        else if (out.status === 'upgraded') result.upgraded++
        else result.skipped++
      } catch (err) {
        const c = classifySyncError(err)
        if (c.fatal || err?.status === 429) {
          if (c.fatal) fatalMessage = c.message
          else softMessage = 'Intervals.icu rate limit reached, continuing on the next run.'
          result.complete = false
          break
        }
        result.failed++
        softMessage = `${result.failed} ride(s) failed to import (last: ${String(err?.message || err).slice(0, 150)})`
      }
      cursor = ride.start_date_local || cursor
    }
  } catch (err) {
    const c = classifySyncError(err)
    if (c.fatal) fatalMessage = c.message
    else softMessage = c.message
    result.complete = false
  }

  result.error = fatalMessage || softMessage || null
  result.fatal = !!fatalMessage

  // Cursor: now when everything was processed, else just past the last handled ride.
  const syncedAt = fatalMessage
    ? null
    : result.complete
      ? startedAt.toISOString()
      : cursor
        ? toIso(cursor, null)
        : null

  try {
    await service.rpc('record_connection_result_for', {
      p_user_id: conn.user_id,
      p_provider: 'intervals',
      p_error: result.error,
      p_fatal: result.fatal,
      p_synced_at: syncedAt,
    })
  } catch (err) {
    console.warn('record_connection_result_for failed:', err?.message)
  }
  return result
}

/** Sync connections sequentially until the deadline; each is claimed (last_attempt_at) first. */
export async function runIntervalsSync(service, connections, deps = {}) {
  const results = []
  for (const conn of connections) {
    if (Date.now() >= (deps.deadline ?? Infinity)) break
    results.push(await syncConnection(service, conn, deps))
  }
  return results
}
