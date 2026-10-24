// src/lib/server/wahooPush.js
//
// Server-side service that pushes planned workouts to the rider's Wahoo Cloud (#311), consistent with
// plannedPush.js (Intervals.icu): runs with the SERVICE client after the caller (route) has authorised the request
// through the RLS client (rider or active coach) or the cron token was verified; tokens never leave the server.
// A planned workout becomes a Wahoo plan (the steps) plus a Wahoo workout (the scheduled day) that references it.
// We only ever touch records whose ids we stored in planned_workout_wahoo_pushes (or that carry our external_id).

import { PushError } from './intervalsEvents.js'
import { createWahooPlanClient } from './wahooPlans.js'
import { getFreshAccessToken } from './wahooProvider.js'
import { buildWahooWorkout, wahooExternalId, wahooPushHash, wahooWorkoutFields, WAHOO_PUSH_DISCIPLINES } from '../wahooPlan.js'
import { CLAIM_TTL_MS, RETRY_SAME_ERROR_MS, PUSH_WINDOW_DAYS, TIME_BUDGET_MS, RIDERS_PER_RUN, PUSHES_PER_RIDER, RIDER_CLAIM_MS } from './plannedPush.js'

const TABLE = 'planned_workout_wahoo_pushes'
const WORKOUT_TABLE = 'planned_workouts'
const NOT_CONNECTED_MESSAGE = 'Connect Wahoo in Settings → Connections to send workouts to it.'
const PUSH_COLUMNS =
  'workout_id, rider_id, wahoo_plan_id, wahoo_workout_id, pushed_hash, pushed_at, pushed_date, push_status, attempted_hash, last_error, last_attempt_at, claimed_until, warnings'
const WORKOUT_COLUMNS = 'id, rider_id, workout_date, discipline, title, description, structure_dsl, structure_manifest, status, activity_id'

const iso = (d) => new Date(d).toISOString()
const day = (d) => iso(d).slice(0, 10)
const addDays = (ms, n) => ms + n * 86400000
const safeMessage = (e) => (e instanceof PushError ? e.message : 'Unexpected error while sending the workout to Wahoo.')
const isNotFound = (e) => e instanceof PushError && e.code === 'not_found'

/** Active Wahoo connection row of the rider, or PushError('not_connected'). */
export async function requireWahooConnection(service, riderId) {
  const { data } = await service
    .from('connections')
    .select('id, user_id, status, external_athlete_id, access_token, refresh_token, token_expires_at')
    .eq('user_id', riderId)
    .eq('provider', 'wahoo')
    .maybeSingle()
  if (!data || data.status === 'disconnected' || !data.refresh_token) {
    throw new PushError('not_connected', NOT_CONNECTED_MESSAGE, { status: 409, fatal: true })
  }
  if (data.status !== 'active') {
    throw new PushError('not_connected', 'Your Wahoo connection needs attention. Reconnect it in Settings → Connections.', { status: 409, fatal: true })
  }
  return data
}

/** Plan client with a fresh access token; token problems become PushErrors. */
export async function defaultMakeClient(service, conn) {
  try {
    return createWahooPlanClient({ accessToken: await getFreshAccessToken(service, conn) })
  } catch (e) {
    if (e instanceof PushError) throw e
    if (e?.fatal) throw new PushError('auth', e.message, { status: 409, fatal: true })
    throw new PushError('unreachable', e?.message || 'Could not reach Wahoo.', { status: 502 })
  }
}

async function riderFtp(service, riderId) {
  const { data } = await service.from('profiles').select('ftp_w').eq('id', riderId).maybeSingle()
  return Number(data?.ftp_w) > 0 ? Number(data.ftp_w) : null
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
 * Creates or updates the Wahoo plan + workout of a planned workout.
 * @returns {{ state: 'pushed', workoutId: string, planId: string|null, warnings: string[], recreated: boolean, structured: boolean }}
 * @throws PushError
 */
export async function pushPlannedWorkoutToWahoo({ service, workout, now = Date.now(), makeClient = defaultMakeClient, conn = null, client = null }) {
  if (!WAHOO_PUSH_DISCIPLINES.includes(workout.discipline || 'ride')) {
    throw new PushError('unsupported', 'Only ride workouts are sent to Wahoo.', { status: 409 })
  }
  const connection = conn || (await requireWahooConnection(service, workout.rider_id))
  const api = client || (await makeClient(service, connection))
  const row = await getRow(service, workout.id)
  await claim(service, workout, row, now)

  const hash = wahooPushHash(workout)
  const stamp = iso(now)
  let planId = row?.wahoo_plan_id || null
  let workoutId = row?.wahoo_workout_id || null
  let recreated = false
  let built

  try {
    built = buildWahooWorkout(workout, { ftp: await riderFtp(service, workout.rider_id) })

    if (built.plan) {
      if (planId) {
        try {
          await api.updatePlan(planId, built.plan, stamp)
        } catch (e) {
          if (!isNotFound(e)) throw e
          planId = null
        }
      }
      if (!planId) {
        // Adopt a plan we created before a lost response instead of duplicating it in the rider's library.
        const found = await api.findPlanByExternalId(wahooExternalId(workout.id))
        if (found) {
          await api.updatePlan(found, built.plan, stamp)
          planId = found
        } else {
          planId = await api.createPlan(built.plan, wahooExternalId(workout.id), stamp)
        }
      }
      await service.from(TABLE).update({ wahoo_plan_id: planId }).eq('workout_id', workout.id)
    } else if (planId) {
      // Steps were removed from the workout: drop the plan (Wahoo detaches it from the workout).
      try {
        await api.deletePlan(planId)
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
      planId = null
      await service.from(TABLE).update({ wahoo_plan_id: null }).eq('workout_id', workout.id)
    }

    const fields = wahooWorkoutFields(workout, { minutes: built.minutes, planId })
    if (workoutId) {
      try {
        workoutId = await api.updateWorkout(workoutId, fields)
      } catch (e) {
        // The rider deleted it in Wahoo: recreate (the plan in Velocity Stack wins).
        if (!isNotFound(e)) throw e
        workoutId = null
        recreated = true
      }
    }
    if (!workoutId) workoutId = await api.createWorkout(fields)
  } catch (e) {
    await record(service, workout.id, { push_status: 'error', attempted_hash: hash, last_error: safeMessage(e), last_attempt_at: stamp })
    throw e
  }

  await record(service, workout.id, {
    push_status: 'pushed',
    wahoo_plan_id: planId,
    wahoo_workout_id: workoutId,
    pushed_hash: hash,
    attempted_hash: hash,
    pushed_at: stamp,
    pushed_date: String(workout.workout_date).slice(0, 10),
    last_error: null,
    warnings: built.warnings,
  })
  return { state: 'pushed', workoutId, planId, warnings: built.warnings, recreated, structured: built.structured }
}

/** Removes the Wahoo workout and plan of a planned workout (the row may be a tombstone) and forgets the mapping. */
export async function removePlannedWorkoutFromWahoo({ service, riderId, workoutId, now = Date.now(), makeClient = defaultMakeClient, conn = null, client = null }) {
  const row = await getRow(service, workoutId)
  if (!row || row.rider_id !== riderId) return { removed: false }
  if (!row.wahoo_workout_id && !row.wahoo_plan_id) {
    await service.from(TABLE).delete().eq('workout_id', workoutId)
    return { removed: false }
  }
  const connection = conn || (await requireWahooConnection(service, riderId))
  const api = client || (await makeClient(service, connection))
  await claim(service, { id: workoutId, rider_id: riderId }, row, now)
  try {
    if (row.wahoo_workout_id) await api.deleteWorkout(row.wahoo_workout_id).catch((e) => { if (!isNotFound(e)) throw e })
    if (row.wahoo_plan_id) await api.deletePlan(row.wahoo_plan_id).catch((e) => { if (!isNotFound(e)) throw e })
  } catch (e) {
    await record(service, workoutId, { last_error: safeMessage(e), last_attempt_at: iso(now) })
    throw e
  }
  await service.from(TABLE).delete().eq('workout_id', workoutId)
  return { removed: true }
}

/** One rider's share of the scheduled Wahoo push. Returns counters; never throws. */
export async function pushWahooRider({ service, riderId, conn, client, now, deadline, limit = PUSHES_PER_RIDER, autoPush = true }) {
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
      await removePlannedWorkoutFromWahoo({ service, riderId, workoutId: t.workout_id, now, conn, client })
      out.removed += 1
    } catch (e) {
      handle(e)
    }
  }
  if (!autoPush) return out

  // Pushed workouts that are skipped now leave the Wahoo calendar (the workout stays).
  const { data: pushed } = await service
    .from(TABLE)
    .select('workout_id')
    .eq('rider_id', riderId)
    .not('wahoo_workout_id', 'is', null)
    .in('push_status', ['pushed', 'error'])
    .limit(500)
  const pushedIds = (pushed || []).map((p) => p.workout_id)
  if (pushedIds.length) {
    const { data: skipped } = await service.from(WORKOUT_TABLE).select('id').eq('rider_id', riderId).eq('status', 'skipped').in('id', pushedIds)
    for (const s of skipped || []) {
      if (!ready()) break
      budget -= 1
      try {
        await removePlannedWorkoutFromWahoo({ service, riderId, workoutId: s.id, now, conn, client })
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
    .in('discipline', WAHOO_PUSH_DISCIPLINES)
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
  for (const w of workouts || []) {
    if (!ready()) break
    const row = rowById.get(w.id)
    const hash = wahooPushHash(w)
    if (row?.wahoo_workout_id && row.pushed_hash === hash && row.push_status === 'pushed') continue
    if (row?.push_status === 'error' && row.attempted_hash === hash && row.last_attempt_at && now - Date.parse(row.last_attempt_at) < RETRY_SAME_ERROR_MS) continue
    budget -= 1
    try {
      await pushPlannedWorkoutToWahoo({ service, workout: w, now, conn, client })
      out.pushed += 1
    } catch (e) {
      handle(e)
    }
  }
  return out
}

/** Cron entry: a bounded batch of Wahoo riders. Per-rider failures are recorded on the connection, never thrown. */
export async function runWahooPushCycle({ service, now = Date.now(), timeBudgetMs = TIME_BUDGET_MS, makeClient = defaultMakeClient }) {
  const deadline = Date.now() + timeBudgetMs
  const staleBefore = iso(now - RIDER_CLAIM_MS)
  const picked = new Map()
  const base = () =>
    service
      .from('connections')
      .select('user_id, planned_push_attempt_at, push_planned_workouts')
      .eq('provider', 'wahoo')
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
      .eq('provider', 'wahoo')
      .or(`planned_push_attempt_at.is.null,planned_push_attempt_at.lt.${staleBefore}`)
      .select('user_id')
    if (!claimed?.length) continue
    totals.riders += 1
    try {
      const conn = await requireWahooConnection(service, riderId)
      const client = await makeClient(service, conn)
      const r = await pushWahooRider({ service, riderId, conn, client, now, deadline, autoPush })
      totals.pushed += r.pushed
      totals.removed += r.removed
      totals.failed += r.failed
      const patch = r.stopped
        ? { planned_push_error: r.stopped.message }
        : { planned_push_error: r.failed ? 'Some workouts could not be sent. Open them in the calendar for details.' : null, planned_push_at: iso(now) }
      await service.from('connections').update(patch).eq('user_id', riderId).eq('provider', 'wahoo')
    } catch (e) {
      totals.failed += 1
      await service.from('connections').update({ planned_push_error: safeMessage(e) }).eq('user_id', riderId).eq('provider', 'wahoo')
    }
  }
  return totals
}
