// src/lib/server/intervalsSync.js
// Background Intervals.icu / Strava / Wahoo sync for one or more connections (#109, faster backfill follow-up).
//
// Two cursors per connection:
//  - forward: last_synced_at. Each run first imports rides newer than it (minus a small overlap), newest first,
//    so new rides arrive promptly even while an old backfill is running.
//  - backfill: backfill_cursor moves BACKWARDS in time from the newest ride to the start of the backfill window
//    (backfill_complete when done), so recent history shows up first.
// Work is bounded per run (wall-clock deadline, Strava request budget, per-turn ride quota); unfinished work
// resumes on the next run. One failing connection never blocks others.

import { createIntervalsProvider } from './intervalsProvider.js'
import { createStravaProviderForConnection } from './stravaProvider.js'
import { createWahooProviderForConnection } from './wahooProvider.js'
import { importActivity, loadImportProfile } from './importActivity.js'
import { repairStravaActivities, STRAVA_REPAIR_PER_RUN } from './stravaRepair.js'
import { loadExistingActivityFingerprints } from '../activityDuplicates.js'
import {
  selectNewRides,
  syncWindowStart,
  classifySyncError,
  backfillBounds,
  needsBackfill,
  advanceBackfillCursor,
  backfillTurnSize,
  rideTimeIso,
  PROVIDER_LABELS,
  STRAVA_BACKFILL_TURN,
} from '../syncPlan.js'

export const INTERVALS_CONCURRENCY = 4
// Each Wahoo import runs the .fit analyzer; the list call (the only API request) is shared.
export const WAHOO_CONCURRENCY = 2
// Listings that only contained already-known rides are cheap, but still bounded per run.
export const MAX_BACKFILL_LISTINGS = 5

// Strava needs the service client (token refresh persists new tokens) and the whole connection row.
function defaultCreateProvider(args, conn, service, deps = {}) {
  if (conn.provider === 'strava') return createStravaProviderForConnection(service, conn, { budget: deps.budget })
  if (conn.provider === 'wahoo') return createWahooProviderForConnection(service, conn)
  return createIntervalsProvider(args)
}

/**
 * Import `todo` (already newest first) in chunks of `concurrency`, stopping at the first fatal/rate/budget
 * error, at `limit` rides or at the deadline. `handled` is the length of the prefix that is safe to move a
 * cursor past (everything before the first stopping ride).
 */
export async function processRides(todo, ctx) {
  const { concurrency = 1, limit = Infinity, deadline = Infinity, importOne, onResult } = ctx
  const out = { handled: 0, stop: null, fatalMessage: null, softMessage: null, failed: 0 }
  let i = 0
  while (i < todo.length && i < limit) {
    if (Date.now() >= deadline) {
      out.stop = 'deadline'
      break
    }
    const chunk = todo.slice(i, Math.min(i + concurrency, limit))
    const outcomes = await Promise.all(
      chunk.map((ride) =>
        importOne(ride).then(
          (value) => ({ ride, value }),
          (error) => ({ ride, error })
        )
      )
    )
    let stopped = false
    for (const o of outcomes) {
      if (o.error) {
        const err = o.error
        const label = PROVIDER_LABELS[ctx.providerName]
        const c = classifySyncError(err, ctx.providerName)
        if (c.fatal) out.fatalMessage = c.message
        else if (err?.budget) out.stop = out.stop || 'budget'
        else if (err?.status === 429) out.softMessage = `${label} rate limit reached, continuing on the next run.`
        if (c.fatal || err?.budget || err?.status === 429) {
          out.stop = out.stop || (c.fatal ? 'fatal' : 'rate')
          stopped = true
          continue
        }
        out.failed++
        out.softMessage = `${out.failed} ride(s) failed to import (last: ${String(err?.message || err).slice(0, 150)})`
        onResult?.(o.ride, null, err)
      } else {
        onResult?.(o.ride, o.value, null)
      }
      if (!stopped) out.handled++
    }
    if (stopped) break
    i += chunk.length
  }
  return out
}

/**
 * Sync a single connection row {provider, user_id, external_athlete_id, api_key|refresh_token, backfill_days,
 * last_synced_at, backfill_cursor, backfill_complete, backfill_imported}. Never throws; returns counters plus
 * `error`/`fatal` when it stopped early, `more` when another run still has work, `handled` rides this run.
 */
export async function syncConnection(service, conn, deps = {}) {
  const {
    analyzeFit,
    now = () => new Date(),
    deadline = Infinity,
    maxFetches = Infinity,
    createProvider = defaultCreateProvider,
    importFn = importActivity,
    maxBackfillRides,
    repairFn = repairStravaActivities,
  } = deps
  const startedAt = now()
  const providerName = conn.provider || 'intervals'
  const result = {
    userId: conn.user_id,
    imported: 0,
    upgraded: 0,
    skipped: 0,
    failed: 0,
    handled: 0,
    complete: true,
    more: false,
    budgetStopped: false,
    repaired: 0,
  }
  let fatalMessage = null
  let softMessage = null
  let forwardDone = false
  let progress = null // backfill progress to persist, set when the backfill phase ran

  try {
    const provider = await createProvider({ athleteId: conn.external_athlete_id, apiKey: conn.api_key }, conn, service, deps)
    const isStrava = provider.source === 'strava'
    const existing = await loadExistingActivityFingerprints(service, conn.user_id)
    const profile = await loadImportProfile(service, conn.user_id)
    const concurrency = deps.concurrency ?? (isStrava ? 1 : provider.source === 'wahoo' ? WAHOO_CONCURRENCY : INTERVALS_CONCURRENCY)

    const run = async (todo, limit) => {
      const outcome = await processRides(todo, {
        providerName,
        concurrency,
        limit,
        deadline,
        importOne: (ride) =>
          importFn({
            supabase: service,
            userId: conn.user_id,
            provider,
            externalId: ride.id,
            options: { title: ride.name || undefined },
            analyzeFit,
            profile,
          }),
        onResult: (ride, value) => {
          if (!value) return
          existing.push({ external_source: provider.source, external_id: String(ride.id) })
          if (value.status === 'imported') result.imported++
          else if (value.status === 'upgraded') result.upgraded++
          else result.skipped++
        },
      })
      result.failed += outcome.failed
      result.handled += outcome.handled
      if (outcome.fatalMessage) fatalMessage = outcome.fatalMessage
      if (outcome.softMessage) softMessage = outcome.softMessage
      if (outcome.stop === 'budget') result.budgetStopped = true
      return outcome
    }

    // ---- Forward: rides newer than the forward cursor (live priority) ----
    forwardDone = !conn.last_synced_at // first run / restart: nothing is "new" yet, the backfill covers it
    if (conn.last_synced_at) {
      provider.setPurpose?.('live')
      const oldest = syncWindowStart({ lastSyncedAt: conn.last_synced_at, backfillDays: conn.backfill_days, now: startedAt })
      const listed = await provider.listActivities({ oldest })
      const todo = selectNewRides(listed, existing, provider.source)
      const outcome = await run(todo, maxFetches)
      forwardDone = outcome.handled === todo.length && !outcome.stop
    }

    // ---- Backfill: newest to oldest, only once the forward part is done ----
    if (forwardDone && needsBackfill(conn)) {
      provider.setPurpose?.('backfill')
      const quota = maxBackfillRides ?? (isStrava ? STRAVA_BACKFILL_TURN : Infinity)
      const { oldest, before } = backfillBounds(conn, startedAt)
      const importedBefore = conn.last_synced_at && conn.backfill_cursor ? Number(conn.backfill_imported) || 0 : 0
      progress = { cursor: before, complete: false, handled: 0, total: null }
      let current = before
      let listings = 0
      let stopped = quota <= 0
      if (quota <= 0) result.budgetStopped = true

      while (!stopped && listings < MAX_BACKFILL_LISTINGS && Date.now() < deadline) {
        listings++
        const { rides, exhausted, nextBefore } = await provider.listWindow({ oldest, before: current })
        const todo = selectNewRides(rides, existing, provider.source)
        if (!isStrava && listings === 1 && exhausted) progress.total = importedBefore + todo.length
        const left = Math.min(quota, maxFetches) - progress.handled
        const outcome = await run(todo, Math.max(0, left))
        progress.handled += outcome.handled
        const step = advanceBackfillCursor({ todo, handled: outcome.handled, exhausted, nextBefore, current })
        current = step.cursor
        progress.cursor = step.cursor
        progress.complete = step.complete
        if (step.complete || outcome.stop || outcome.handled < todo.length) stopped = true
        if (progress.handled >= Math.min(quota, maxFetches)) stopped = true
      }
    }

    // ---- Repair: Strava rides imported without heartrate / curve rows (cheap, after new work) ----
    if (isStrava && forwardDone && !result.budgetStopped && !fatalMessage) {
      try {
        const fixed = await repairFn(service, {
          userId: conn.user_id,
          provider,
          maxFetches: Math.min(STRAVA_REPAIR_PER_RUN, maxFetches),
        })
        result.repaired = (fixed.curvesRebuilt || 0) + (fixed.reanalyzed || 0)
        if (fixed.stop === 'budget') result.budgetStopped = true
        if (fixed.error) softMessage = softMessage || `Repair issue: ${String(fixed.error).slice(0, 150)}`
      } catch (err) {
        console.warn('Strava repair failed:', err?.message)
      }
    }
  } catch (err) {
    const c = classifySyncError(err, providerName)
    if (c.fatal) fatalMessage = c.message
    else if (err?.budget) result.budgetStopped = true
    else softMessage = err?.status === 429 ? `${PROVIDER_LABELS[providerName]} rate limit reached, continuing on the next run.` : c.message
  }

  result.error = fatalMessage || softMessage || null
  result.fatal = !!fatalMessage
  const backfillDone = needsBackfill(conn) ? !!progress?.complete : true
  result.more = !result.fatal && (!forwardDone || !backfillDone)
  result.complete = !result.more
  result.backfillComplete = backfillDone

  // Forward cursor: the run start once the forward part finished (backfill progress has its own cursor).
  const syncedAt = fatalMessage || !forwardDone ? null : startedAt.toISOString()

  try {
    await service.rpc('record_connection_result_for', {
      p_user_id: conn.user_id,
      p_provider: providerName,
      p_error: result.error,
      p_fatal: result.fatal,
      p_synced_at: syncedAt,
    })
    if (progress) {
      const importedBefore = conn.last_synced_at && conn.backfill_cursor ? Number(conn.backfill_imported) || 0 : 0
      await service.rpc('record_backfill_progress', {
        p_user_id: conn.user_id,
        p_provider: providerName,
        p_backfill_days: conn.backfill_days ?? null,
        p_cursor: progress.cursor,
        p_complete: progress.complete,
        // Absolute restart (new window / first run) is expressed as a delta from the stored counter.
        p_imported_delta: importedBefore + progress.handled - (Number(conn.backfill_imported) || 0),
        p_total: progress.complete ? importedBefore + progress.handled : progress.total,
      })
    }
  } catch (err) {
    console.warn('recording sync result failed:', err?.message)
  }
  return result
}

/**
 * Sync connections sequentially until the deadline. Each connection gets an equal slice of the remaining
 * time and (Strava) a fair share of the remaining backfill budget, so the least recently served rider goes
 * first and no rider starves the others.
 */
export async function runIntervalsSync(service, connections, deps = {}) {
  const results = []
  const deadline = deps.deadline ?? Infinity
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i]
    if (Date.now() >= deadline) break
    const remainingConns = connections.length - i
    const slice = Number.isFinite(deadline) ? Date.now() + (deadline - Date.now()) / remainingConns : Infinity
    const perConn = { ...deps, deadline: slice }
    if (conn.provider === 'strava' && deps.budget) {
      const riders = connections.slice(i).filter(needsBackfill).length
      perConn.maxBackfillRides = backfillTurnSize({ remaining: deps.budget.remaining('backfill') - 2, riders })
    }
    results.push(await syncConnection(service, conn, perConn))
  }
  return results
}
