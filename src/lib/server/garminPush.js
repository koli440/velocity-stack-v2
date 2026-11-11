// src/lib/server/garminPush.js
//
// Server-side service that pushes planned workouts to the rider's Garmin Connect (#310) through the Training API,
// consistent with wahooPush.js: runs with the SERVICE client after the caller (route) has authorised the request
// through the RLS client (rider or active coach) or the cron token was verified; tokens never leave the server.
// A planned workout becomes a Garmin workout (the steps) plus a schedule entry (the day). We only ever touch
// records whose ids we stored in planned_workout_garmin_pushes.

import { PushError } from './intervalsEvents.js'
import { createGarminPlanClient } from './garminPlans.js'
import { getFreshAccessToken } from './garminProvider.js'
import { createPowerBasisLoader } from './pushPowerBasis.js'
import { buildGarminWorkout, garminPushHash, normalizePowerTarget, GARMIN_PUSH_DISCIPLINES } from '../garminPlan.js'
import { CLAIM_TTL_MS, RETRY_SAME_ERROR_MS, PUSH_WINDOW_DAYS, TIME_BUDGET_MS, RIDERS_PER_RUN, PUSHES_PER_RIDER, RIDER_CLAIM_MS } from './plannedPush.js'

const TABLE = 'planned_workout_garmin_pushes'
const WORKOUT_TABLE = 'planned_workouts'
const NOT_CONNECTED_MESSAGE = 'Connect Garmin in Settings → Connections to send workouts to it.'
const PUSH_COLUMNS =
  'workout_id, rider_id, garmin_workout_id, garmin_schedule_id, pushed_hash, pushed_at, pushed_date, push_status, attempted_hash, last_error, last_attempt_at, claimed_until, warnings'
const WORKOUT_COLUMNS = 'id, rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, status, activity_id'

const iso = (d) => new Date(d).toISOString()
const day = (d) => iso(d).slice(0, 10)
const addDays = (ms, n) => ms + n * 86400000
const safeMessage = (e) => (e instanceof PushError ? e.message : 'Unexpected error while sending the workout to Garmin.')
const isNotFound = (e) => e instanceof PushError && e.code === 'not_found'

/** Active Garmin connection row of the rider, or PushError('not_connected'). */
export async function requireGarminConnection(service, riderId) {
  const { data } = await service
    .from('connections')
    .select('id, user_id, status, external_athlete_id, access_token, refresh_token, token_expires_at, push_power_target')
    .eq('user_id', riderId)
    .eq('provider', 'garmin')
    .maybeSingle()
  if (!data || data.status === 'disconnected' || !data.refresh_token) {
    throw new PushError('not_connected', NOT_CONNECTED_MESSAGE, { status: 409, fatal: true })
  }
  if (data.status !== 'active') {
    throw new PushError('not_connected', 'Your Garmin connection needs attention. Reconnect it in Settings → Connections.', { status: 409, fatal: true })
  }
  return data
}

/** Plan client with a fresh access token; token problems become PushErrors. */
export async function defaultMakeClient(service, conn) {
  try {
    return createGarminPlanClient({ accessToken: await getFreshAccessToken(service, conn) })
  } catch (e) {
    if (e instanceof PushError) throw e
    if (e?.fatal) throw new PushError('auth', e.message, { status: 409, fatal: true })
    throw new PushError('unreachable', e?.message || 'Could not reach Garmin.', { status: 502 })
  }
}

async function getRow(service, workoutId) {
  const { data } = await service.from(TABLE).select(PUSH_COLUMNS).eq('workout_id', workoutId).maybeSingle()
  return data || null
}

const BUSY = () => new PushError('busy', 'A push for this workout is already running. Try again in a moment.', { status: 409 })

async function claim(service, workout, row, now) {
  const until = iso(now + CLAIM_TTL_MS)
  if (!row) {
    const { error } = await service
      .from(TABLE)
      .insert({ workout_id: workout.id, rider_id: workout.rider_id, push_status: 'pending', claimed_until: until, last_attempt_at: iso(now) })
    if (error) throw BUSY()
    return
  }
  const { data } = await service
    .from(TABLE)
    .update({ claimed_until: until, last_attempt_at: iso(now) })
    .eq('workout_id', workout.id)
    .or(`claimed_until.is.null,claimed_until.lt.${iso(now)}`)
    .select('workout_id')
  if (!data?.length) throw BUSY()
}

async function record(service, workoutId, patch) {
  await service.from(TABLE).update({ ...patch, claimed_until: null, updated_at: iso(Date.now()) }).eq('workout_id', workoutId)
}

/**
 * Creates or updates the Garmin workout + schedule entry of a planned workout.
 * @returns {{ state: 'pushed', workoutId: string, scheduleId: string, warnings: string[], recreated: boolean }}
 * @throws PushError
 */
export async function pushPlannedWorkoutToGarmin({ service, workout, now = Date.now(), makeClient = defaultMakeClient, conn = null, client = null, basisFor = null }) {
  if (!GARMIN_PUSH_DISCIPLINES.includes(workout.discipline || 'ride')) {
    throw new PushError('unsupported', 'Only ride workouts are sent to Garmin.', { status: 409 })
  }
  const connection = conn || (await requireGarminConnection(service, workout.rider_id))
  const api = client || (await makeClient(service, connection))
  const row = await getRow(service, workout.id)
  await claim(service, workout, row, now)

  const powerTarget = normalizePowerTarget(connection.push_power_target)
  const basis = await (basisFor || createPowerBasisLoader(service, workout.rider_id))(workout.workout_date)
  const hash = garminPushHash(workout, powerTarget, basis)
  const stamp = iso(now)
  const date = String(workout.workout_date).slice(0, 10)
  let workoutId = row?.garmin_workout_id || null
  let scheduleId = row?.garmin_schedule_id || null
  let recreated = false
  let built

  try {
    built = buildGarminWorkout(workout, { basis, powerTarget })
    if (!built.workout) {
      throw new PushError('unsupported', 'This workout has no steps, so it cannot be sent to Garmin. Add structured steps first.', { status: 409 })
    }

    if (workoutId) {
      try {
        await api.updateWorkout(workoutId, built.workout)
      } catch (e) {
        // The rider deleted it in Garmin: recreate (the plan in Velocity Stack wins).
        if (!isNotFound(e)) throw e
        workoutId = null
        scheduleId = null
        recreated = true
      }
    }
    if (!workoutId) {
      workoutId = await api.createWorkout(built.workout)
      scheduleId = null
    }
    await service.from(TABLE).update({ garmin_workout_id: workoutId, garmin_schedule_id: scheduleId }).eq('workout_id', workout.id)

    if (scheduleId) {
      try {
        await api.updateSchedule(scheduleId, workoutId, date)
      } catch (e) {
        if (!isNotFound(e)) throw e
        scheduleId = null
        recreated = true
      }
    }
    if (!scheduleId) scheduleId = await api.createSchedule(workoutId, date)
  } catch (e) {
    await record(service, workout.id, { push_status: 'error', attempted_hash: hash, last_error: safeMessage(e), last_attempt_at: stamp })
    throw e
  }

  await record(service, workout.id, {
    push_status: 'pushed',
    garmin_workout_id: workoutId,
    garmin_schedule_id: scheduleId,
    pushed_hash: hash,
    attempted_hash: hash,
    pushed_at: stamp,
    pushed_date: date,
    last_error: null,
    warnings: built.warnings,
  })
  return { state: 'pushed', workoutId, scheduleId, warnings: built.warnings, recreated }
}

/** Removes the Garmin schedule entry and workout of a planned workout (the row may be a tombstone) and forgets the mapping. */
export async function removePlannedWorkoutFromGarmin({ service, riderId, workoutId, now = Date.now(), makeClient = defaultMakeClient, conn = null, client = null }) {
  const row = await getRow(service, workoutId)
  if (!row || row.rider_id !== riderId) return { removed: false }
  if (!row.garmin_workout_id && !row.garmin_schedule_id) {
    await service.from(TABLE).delete().eq('workout_id', workoutId)
    return { removed: false }
  }
  const connection = conn || (await requireGarminConnection(service, riderId))
  const api = client || (await makeClient(service, connection))
  await claim(service, { id: workoutId, rider_id: riderId }, row, now)
  try {
    if (row.garmin_schedule_id) await api.deleteSchedule(row.garmin_schedule_id).catch((e) => { if (!isNotFound(e)) throw e })
    if (row.garmin_workout_id) await api.deleteWorkout(row.garmin_workout_id).catch((e) => { if (!isNotFound(e)) throw e })
  } catch (e) {
    await record(service, workoutId, { last_error: safeMessage(e), last_attempt_at: iso(now) })
    throw e
  }
  await service.from(TABLE).delete().eq('workout_id', workoutId)
  return { removed: true }
}

/** One rider's share of the scheduled Garmin push. Returns counters; never throws. */
export async function pushGarminRider({ service, riderId, conn, client, now, deadline, limit = PUSHES_PER_RIDER, autoPush = true }) {
  const out = { pushed: 0, removed: 0, failed: 0, stopped: null }
  let budget = limit
  const timeLeft = () => Date.now() < deadline
  const handle = (e) => {
    out.failed += 1
    if (e instanceof PushError && (e.fatal || e.code === 'rate_limited')) out.stopped = e
  }
  const ready = () => timeLeft() && budget > 0 && !out.stopped

  const { data: tombs } = await service.from(TABLE).select('workout_id').eq('rider_id', riderId).eq('push_status', 'pending_delete').limit(budget)
  for (const t of tombs || []) {
    if (!ready()) break
    budget -= 1
    try {
      await removePlannedWorkoutFromGarmin({ service, riderId, workoutId: t.workout_id, now, conn, client })
      out.removed += 1
    } catch (e) {
      handle(e)
    }
  }
  if (!autoPush) return out

  // Pushed workouts that are skipped now leave the Garmin calendar (the workout stays).
  const { data: pushed } = await service
    .from(TABLE)
    .select('workout_id')
    .eq('rider_id', riderId)
    .not('garmin_workout_id', 'is', null)
    .in('push_status', ['pushed', 'error'])
    .limit(500)
  const pushedIds = (pushed || []).map((p) => p.workout_id)
  if (pushedIds.length) {
    const { data: skipped } = await service.from(WORKOUT_TABLE).select('id').eq('rider_id', riderId).eq('status', 'skipped').in('id', pushedIds)
    for (const s of skipped || []) {
      if (!ready()) break
      budget -= 1
      try {
        await removePlannedWorkoutFromGarmin({ service, riderId, workoutId: s.id, now, conn, client })
        out.removed += 1
      } catch (e) {
        handle(e)
      }
    }
  }

  if (out.stopped) return out
  const { data: workouts } = await service
    .from(WORKOUT_TABLE)
    .select(WORKOUT_COLUMNS)
    .eq('rider_id', riderId)
    .eq('status', 'planned')
    .is('activity_id', null)
    .in('discipline', GARMIN_PUSH_DISCIPLINES)
    .gte('workout_date', day(now))
    .lte('workout_date', day(addDays(now, PUSH_WINDOW_DAYS)))
    .order('workout_date', { ascending: true })
    .limit(200)
  const ids = (workouts || []).map((w) => w.id)
  const rowById = new Map()
  if (ids.length) {
    const { data: rows } = await service.from(TABLE).select(PUSH_COLUMNS).in('workout_id', ids)
    for (const r of rows || []) rowById.set(r.workout_id, r)
  }
  const basisFor = createPowerBasisLoader(service, riderId)
  for (const w of workouts || []) {
    if (!ready()) break
    const row = rowById.get(w.id)
    const hash = garminPushHash(w, conn?.push_power_target, await basisFor(w.workout_date))
    if (row?.garmin_workout_id && row.pushed_hash === hash && row.push_status === 'pushed') continue
    if (row?.push_status === 'error' && row.attempted_hash === hash && row.last_attempt_at && now - Date.parse(row.last_attempt_at) < RETRY_SAME_ERROR_MS) continue
    budget -= 1
    try {
      await pushPlannedWorkoutToGarmin({ service, workout: w, now, conn, client, basisFor })
      out.pushed += 1
    } catch (e) {
      handle(e)
    }
  }
  return out
}

/** Cron entry: a bounded batch of Garmin riders. Per-rider failures are recorded on the connection, never thrown. */
export async function runGarminPushCycle({ service, now = Date.now(), timeBudgetMs = TIME_BUDGET_MS, makeClient = defaultMakeClient }) {
  const deadline = Date.now() + timeBudgetMs
  const staleBefore = iso(now - RIDER_CLAIM_MS)
  const picked = new Map()
  const base = () =>
    service
      .from('connections')
      .select('user_id, planned_push_attempt_at, push_planned_workouts')
      .eq('provider', 'garmin')
      .eq('status', 'active')
      .not('refresh_token', 'is', null)
      .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)

  const { data: auto } = await base()
    .eq('push_planned_workouts', true)
    .order('planned_push_attempt_at', { ascending: true, nullsFirst: true })
    .limit(RIDERS_PER_RUN)
  for (const c of auto || []) picked.set(c.user_id, { autoPush: true })

  if (picked.size < RIDERS_PER_RUN) {
    const { data: tombs } = await service.from(TABLE).select('rider_id').eq('push_status', 'pending_delete').limit(100)
    const riders = [...new Set((tombs || []).map((t) => t.rider_id))].filter((r) => !picked.has(r))
    if (riders.length) {
      const { data: conns } = await base().in('user_id', riders).limit(RIDERS_PER_RUN - picked.size)
      for (const c of conns || []) picked.set(c.user_id, { autoPush: false })
    }
  }

  const totals = { riders: 0, pushed: 0, removed: 0, failed: 0 }
  for (const [riderId, { autoPush }] of picked) {
    if (Date.now() >= deadline) break
    const { data: claimed } = await service
      .from('connections')
      .update({ planned_push_attempt_at: iso(now) })
      .eq('user_id', riderId)
      .eq('provider', 'garmin')
      .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)
      .select('user_id')
    if (!claimed?.length) continue
    totals.riders += 1
    try {
      const conn = await requireGarminConnection(service, riderId)
      const client = await makeClient(service, conn)
      const r = await pushGarminRider({ service, riderId, conn, client, now, deadline, autoPush })
      totals.pushed += r.pushed
      totals.removed += r.removed
      totals.failed += r.failed
      const patch = r.stopped
        ? { planned_push_error: r.stopped.message }
        : { planned_push_error: r.failed ? 'Some workouts could not be sent. Open them in the calendar for details.' : null, planned_push_at: iso(now) }
      await service.from('connections').update(patch).eq('user_id', riderId).eq('provider', 'garmin')
    } catch (e) {
      totals.failed += 1
      await service.from('connections').update({ planned_push_error: safeMessage(e) }).eq('user_id', riderId).eq('provider', 'garmin')
    }
  }
  return totals
}
