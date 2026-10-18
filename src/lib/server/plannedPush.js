// src/lib/server/plannedPush.js
//
// Server-side service that pushes planned workouts to the rider's Intervals.icu calendar.
// It runs with the SERVICE client: the caller (route) has already authorised the request through the RLS
// client (rider or active coach), or the cron token has been verified. The connection (API key, athlete
// id) is loaded here and never returned.
//
// We only ever touch events whose id we stored in planned_workout_pushes (or that carry our external_id).

import { loadIntervalsConnection } from './connections.js'
import { createIntervalsEventsClient, PushError } from './intervalsEvents.js'
import { buildIntervalsEvent, externalIdFor, plannedPushHash } from '../intervalsWorkout.js'

export const CLAIM_TTL_MS = 2 * 60 * 1000
export const RETRY_SAME_ERROR_MS = 6 * 60 * 60 * 1000
export const PUSH_WINDOW_DAYS = 60
export const TIME_BUDGET_MS = 45000
export const RIDERS_PER_RUN = 10
export const PUSHES_PER_RIDER = 25
export const RIDER_CLAIM_MS = 5 * 60 * 1000

export const SETTINGS_PATH = '/settings'
const NOT_CONNECTED_MESSAGE = 'Connect Intervals.icu in Settings → Connections to send workouts to it.'

const PUSH_COLUMNS =
  'workout_id, rider_id, intervals_event_id, pushed_hash, pushed_at, pushed_date, push_status, attempted_hash, last_error, last_attempt_at, claimed_until, warnings'
const WORKOUT_COLUMNS =
  'id, rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, status, activity_id'

const iso = (d) => new Date(d).toISOString()
const day = (d) => iso(d).slice(0, 10)

/** Loads the rider's active Intervals connection or throws PushError('not_connected'). */
async function requireConnection(service, riderId) {
  const conn = await loadIntervalsConnection({ supabase: service, userId: riderId, serviceClient: service })
  if (!conn.apiKey || !conn.athleteId || conn.status !== 'active') {
    const message =
      conn.status === 'error'
        ? 'Your Intervals.icu connection needs attention. Reconnect it in Settings → Connections.'
        : NOT_CONNECTED_MESSAGE
    throw new PushError('not_connected', message, { status: 409, fatal: true })
  }
  return conn
}

async function getPushRow(service, workoutId) {
  const { data } = await service.from('planned_workout_pushes').select(PUSH_COLUMNS).eq('workout_id', workoutId).maybeSingle()
  return data || null
}

/** Marks the row as being worked on. Throws PushError('busy') when another push is in flight. */
async function claim(service, workout, row, now) {
  const until = iso(now + CLAIM_TTL_MS)
  if (!row) {
    const { error } = await service
      .from('planned_workout_pushes')
      .insert({ workout_id: workout.id, rider_id: workout.rider_id, push_status: 'pending', claimed_until: until, last_attempt_at: iso(now) })
    if (error) throw new PushError('busy', 'A push for this workout is already running. Try again in a moment.', { status: 409 })
    return
  }
  const { data } = await service
    .from('planned_workout_pushes')
    .update({ claimed_until: until, last_attempt_at: iso(now) })
    .eq('workout_id', workout.id)
    .or(`claimed_until.is.null,claimed_until.lt.${iso(now)}`)
    .select('workout_id')
  if (!data?.length) throw new PushError('busy', 'A push for this workout is already running. Try again in a moment.', { status: 409 })
}

async function record(service, workoutId, patch) {
  await service
    .from('planned_workout_pushes')
    .update({ ...patch, claimed_until: null, updated_at: iso(Date.now()) })
    .eq('workout_id', workoutId)
}

const safeMessage = (e) => (e instanceof PushError ? e.message : 'Unexpected error while sending the workout to Intervals.icu.')

/**
 * Creates or updates the Intervals.icu event of a planned workout.
 * @returns {{ state: 'pushed', eventId: string, warnings: string[], recreated: boolean, structured: boolean }}
 * @throws PushError
 */
export async function pushPlannedWorkout({ service, workout, now = Date.now(), makeClient = createIntervalsEventsClient, conn = null }) {
  const connection = conn || (await requireConnection(service, workout.rider_id))
  const client = makeClient({ athleteId: connection.athleteId, apiKey: connection.apiKey })
  const row = await getPushRow(service, workout.id)
  await claim(service, workout, row, now)

  const hash = plannedPushHash(workout)
  const { event, warnings, structured } = buildIntervalsEvent(workout)
  const extId = externalIdFor(workout.id)
  const date = event.start_date_local.slice(0, 10)
  let eventId = row?.intervals_event_id || null
  let recreated = false

  try {
    if (eventId) {
      try {
        eventId = await client.update(eventId, event)
      } catch (e) {
        // The rider deleted it in Intervals.icu: recreate (decision: the plan in Velocity Stack wins).
        if (!(e instanceof PushError && e.code === 'not_found')) throw e
        eventId = null
        recreated = true
      }
    }
    if (!eventId) {
      // Adopt an event we created before a lost response, instead of duplicating it.
      eventId = await client.findByExternalId(extId, date, date)
      eventId = eventId ? await client.update(eventId, event) : await client.create(event)
    }
  } catch (e) {
    await record(service, workout.id, {
      push_status: 'error',
      attempted_hash: hash,
      last_error: safeMessage(e),
      last_attempt_at: iso(now),
    })
    throw e
  }

  await record(service, workout.id, {
    push_status: 'pushed',
    intervals_event_id: eventId,
    pushed_hash: hash,
    attempted_hash: hash,
    pushed_at: iso(now),
    pushed_date: date,
    last_error: null,
    warnings,
  })
  return { state: 'pushed', eventId, warnings, recreated, structured }
}

/**
 * Removes the Intervals.icu event of a workout (workout row may already be gone: tombstone) and forgets the
 * mapping. Events that carry a different external_id (not ours) are left alone.
 */
export async function removePlannedWorkoutPush({ service, riderId, workoutId, now = Date.now(), makeClient = createIntervalsEventsClient }) {
  const row = await getPushRow(service, workoutId)
  if (!row || row.rider_id !== riderId) return { removed: false }
  if (!row.intervals_event_id) {
    await service.from('planned_workout_pushes').delete().eq('workout_id', workoutId)
    return { removed: false }
  }
  const conn = await requireConnection(service, riderId)
  const client = makeClient({ athleteId: conn.athleteId, apiKey: conn.apiKey })
  await claim(service, { id: workoutId, rider_id: riderId }, row, now)
  try {
    const remote = await client.get(row.intervals_event_id)
    const foreign = remote && remote.external_id && remote.external_id !== externalIdFor(workoutId)
    if (remote && !foreign) await client.remove(row.intervals_event_id)
  } catch (e) {
    await record(service, workoutId, { last_error: safeMessage(e), last_attempt_at: iso(now) })
    throw e
  }
  await service.from('planned_workout_pushes').delete().eq('workout_id', workoutId)
  return { removed: true }
}

const addDays = (ms, n) => ms + n * 86400000

/** One rider's share of the scheduled push. Returns counters; never throws. */
export async function pushRider({ service, riderId, conn, now, deadline, makeClient, limit = PUSHES_PER_RIDER, autoPush = true }) {
  const out = { pushed: 0, removed: 0, failed: 0, stopped: null }
  let budget = limit
  const timeLeft = () => Date.now() < deadline
  const handle = (e) => {
    out.failed += 1
    if (e instanceof PushError && (e.fatal || e.code === 'rate_limited')) out.stopped = e
    return out.stopped
  }

  // 1. Tombstones (deleted workouts) - always, we only delete events we created.
  const { data: tombs } = await service
    .from('planned_workout_pushes')
    .select('workout_id')
    .eq('rider_id', riderId)
    .eq('push_status', 'pending_delete')
    .limit(budget)
  for (const t of tombs || []) {
    if (!timeLeft() || budget <= 0 || out.stopped) break
    budget -= 1
    try {
      await removePlannedWorkoutPush({ service, riderId, workoutId: t.workout_id, now, makeClient })
      out.removed += 1
    } catch (e) {
      handle(e)
    }
  }
  if (!autoPush) return out

  // 2. Workouts that were pushed but are skipped now: take them out of the calendar (the workout stays).
  const { data: pushed } = await service
    .from('planned_workout_pushes')
    .select(PUSH_COLUMNS)
    .eq('rider_id', riderId)
    .not('intervals_event_id', 'is', null)
    .in('push_status', ['pushed', 'error'])
    .limit(500)
  const pushedById = new Map((pushed || []).map((p) => [p.workout_id, p]))
  if (pushedById.size) {
    const { data: skipped } = await service
      .from(WORKOUT_TABLE)
      .select('id')
      .eq('rider_id', riderId)
      .eq('status', 'skipped')
      .in('id', [...pushedById.keys()])
    for (const s of skipped || []) {
      if (!timeLeft() || budget <= 0 || out.stopped) break
      budget -= 1
      try {
        await removePlannedWorkoutPush({ service, riderId, workoutId: s.id, now, makeClient })
        pushedById.delete(s.id)
        out.removed += 1
      } catch (e) {
        handle(e)
      }
    }
  }

  // 3. New / changed workouts in the window.
  if (out.stopped) return out
  const { data: workouts } = await service
    .from(WORKOUT_TABLE)
    .select(WORKOUT_COLUMNS)
    .eq('rider_id', riderId)
    .eq('status', 'planned')
    .is('activity_id', null)
    .gte('workout_date', day(now))
    .lte('workout_date', day(addDays(now, PUSH_WINDOW_DAYS)))
    .order('workout_date', { ascending: true })
    .limit(200)
  const ids = (workouts || []).map((w) => w.id)
  const rowById = new Map()
  if (ids.length) {
    const { data: rows } = await service.from('planned_workout_pushes').select(PUSH_COLUMNS).in('workout_id', ids)
    for (const r of rows || []) rowById.set(r.workout_id, r)
  }
  for (const w of workouts || []) {
    if (!timeLeft() || budget <= 0 || out.stopped) break
    const row = rowById.get(w.id)
    const hash = plannedPushHash(w)
    if (row?.intervals_event_id && row.pushed_hash === hash && row.push_status === 'pushed') continue
    if (row?.push_status === 'error' && row.attempted_hash === hash && row.last_attempt_at && now - Date.parse(row.last_attempt_at) < RETRY_SAME_ERROR_MS) continue
    budget -= 1
    try {
      await pushPlannedWorkout({ service, workout: w, now, makeClient, conn })
      out.pushed += 1
    } catch (e) {
      handle(e)
    }
  }
  return out
}

const WORKOUT_TABLE = 'planned_workouts'

/** Cron entry: a bounded batch of riders. Per-rider failures are recorded on the connection, never thrown. */
export async function runPlannedPushCycle({ service, now = Date.now(), timeBudgetMs = TIME_BUDGET_MS, makeClient = createIntervalsEventsClient }) {
  const deadline = Date.now() + timeBudgetMs
  const staleBefore = iso(now - RIDER_CLAIM_MS)
  const picked = new Map()

  const { data: auto } = await service
    .from('connections')
    .select('user_id, planned_push_attempt_at, push_planned_workouts')
    .eq('provider', 'intervals')
    .eq('status', 'active')
    .eq('push_planned_workouts', true)
    .not('api_key', 'is', null)
    .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)
    .order('planned_push_attempt_at', { ascending: true, nullsFirst: true })
    .limit(RIDERS_PER_RUN)
  for (const c of auto || []) picked.set(c.user_id, { autoPush: true })

  if (picked.size < RIDERS_PER_RUN) {
    const { data: tombs } = await service.from('planned_workout_pushes').select('rider_id').eq('push_status', 'pending_delete').limit(100)
    const riders = [...new Set((tombs || []).map((t) => t.rider_id))].filter((r) => !picked.has(r))
    if (riders.length) {
      const { data: conns } = await service
        .from('connections')
        .select('user_id, planned_push_attempt_at, push_planned_workouts')
        .eq('provider', 'intervals')
        .eq('status', 'active')
        .in('user_id', riders)
        .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)
        .limit(RIDERS_PER_RUN - picked.size)
      for (const c of conns || []) picked.set(c.user_id, { autoPush: false })
    }
  }

  const totals = { riders: 0, pushed: 0, removed: 0, failed: 0 }
  for (const [riderId, { autoPush }] of picked) {
    if (Date.now() >= deadline) break
    // Claim the rider so overlapping runs don't both work on it.
    const { data: claimed } = await service
      .from('connections')
      .update({ planned_push_attempt_at: iso(now) })
      .eq('user_id', riderId)
      .eq('provider', 'intervals')
      .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)
      .select('user_id')
    if (!claimed?.length) continue
    totals.riders += 1
    try {
      const conn = await requireConnection(service, riderId)
      const r = await pushRider({ service, riderId, conn, now, deadline, makeClient, autoPush })
      totals.pushed += r.pushed
      totals.removed += r.removed
      totals.failed += r.failed
      const patch = r.stopped
        ? { planned_push_error: r.stopped.message }
        : { planned_push_error: r.failed ? 'Some workouts could not be sent. Open them in the calendar for details.' : null, planned_push_at: iso(now) }
      await service.from('connections').update(patch).eq('user_id', riderId).eq('provider', 'intervals')
    } catch (e) {
      totals.failed += 1
      await service.from('connections').update({ planned_push_error: safeMessage(e) }).eq('user_id', riderId).eq('provider', 'intervals')
    }
  }
  return totals
}
