// src/lib/server/gymLoadStore.js
//
// Computes and STORES the training load of gym sessions (issue #336). Design and rules: docs/gym-load.md.
//
//  * Computed once per save: right after an import / repair / editor save (and by the self-service and admin backfill)
//    with the rider's history UP TO that session's date (earlier sessions only, strictly before activity_date).
//  * The stored value is not rewritten silently when later sessions arrive. It is recomputed only when the session itself
//    changed (gym_load_stale, set by a trigger when the detail is edited), by an explicit save call, or by an admin
//    "rescore" after a model version bump.
//  * Needs a client that can write gym_load_details (service role): callers authorise the request first.
//  * Never read by anything but fitness / calendar / activity page as an ESTIMATE: activities.gym_load_model marks it.

import { computeGymLoad, summarizeHistory, typicalGymHr, nameKey } from '../gymLoad.js'
import { fetchGymDetail } from '../gymDetail.js'

/** Bump when gymLoad.js changes the numbers; an admin rescore then recomputes older rows. */
export const GYM_LOAD_MODEL_VERSION = 1
export const BACKFILL_BATCH = 25
const PAGE = 1000
const IN_CHUNK = 200

const ACTIVITY_COLUMNS = 'id, user_id, activity_type, activity_date, elapsed_time_s, moving_time_s, duration_sec, avg_hr'

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

async function pageAll(buildQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/** The rider's PRIOR gym exercises (same name_keys only) and prior avg HRs, strictly before `before`. */
async function loadHistory(client, { userId, activityId, before, nameKeys }) {
  const priorActs = await pageAll(() =>
    client
      .from('activities')
      .select('id, avg_hr')
      .eq('user_id', userId)
      .eq('activity_type', 'gym')
      .lt('activity_date', before)
      .neq('id', activityId)
      .order('activity_date', { ascending: true })
      .order('id', { ascending: true })
  )
  const priorIds = new Set(priorActs.map((a) => a.id))
  const typicalHr = typicalGymHr(priorActs.map((a) => num(a.avg_hr)))
  if (!priorIds.size || !nameKeys.length) return { history: {}, typicalHr }

  const exercises = (
    await pageAll(() =>
      client
        .from('gym_exercises')
        .select('id, activity_id, name_key')
        .eq('user_id', userId)
        .in('name_key', nameKeys)
        .order('id', { ascending: true })
    )
  ).filter((e) => priorIds.has(e.activity_id))
  const setsByExercise = new Map()
  for (let i = 0; i < exercises.length; i += IN_CHUNK) {
    const ids = exercises.slice(i, i + IN_CHUNK).map((e) => e.id)
    const sets = await pageAll(() =>
      client
        .from('gym_sets')
        .select('exercise_id, set_type, kind, load_mode, reps, weight_kg, metrics')
        .in('exercise_id', ids)
        .order('id', { ascending: true })
    )
    for (const s of sets) {
      if (!setsByExercise.has(s.exercise_id)) setsByExercise.set(s.exercise_id, [])
      setsByExercise.get(s.exercise_id).push(s)
    }
  }
  const prior = exercises.map((e) => ({ activity_id: e.activity_id, name_key: e.name_key, sets: setsByExercise.get(e.id) || [] }))
  return { history: summarizeHistory(prior), typicalHr }
}

/**
 * Scores one gym activity and stores the result.
 * @returns {Promise<{ status: 'stored'|'no_detail'|'not_gym'|'not_found', load?: number, result?: object }>}
 */
export async function computeAndStoreGymLoad(client, activityId) {
  const { data: act, error } = await client.from('activities').select(ACTIVITY_COLUMNS).eq('id', activityId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!act) return { status: 'not_found' }
  if (act.activity_type !== 'gym') return { status: 'not_gym' }

  const now = new Date().toISOString()
  const detail = await fetchGymDetail(client, activityId)
  if (!detail?.exercises?.some((e) => e.sets?.some((s) => s.set_type !== 'rest'))) {
    // Summary-only sources (no sets) get no estimate; marked as scored so backfills do not retry them.
    const { error: upErr } = await client
      .from('activities')
      .update({ training_load: null, gym_load_model: null, gym_load_at: now, gym_load_stale: false })
      .eq('id', activityId)
    if (upErr) throw new Error(upErr.message)
    await client.from('gym_load_details').delete().eq('activity_id', activityId)
    return { status: 'no_detail' }
  }

  const nameKeys = [...new Set(detail.exercises.map((e) => nameKey(e.name)).filter(Boolean))]
  const { history, typicalHr } = await loadHistory(client, { userId: act.user_id, activityId, before: act.activity_date, nameKeys })
  const result = computeGymLoad({
    exercises: detail.exercises,
    durationS: num(act.elapsed_time_s) ?? num(act.moving_time_s) ?? num(act.duration_sec),
    avgHr: num(act.avg_hr),
    history,
    typicalHr,
  })

  const stored = {
    load: result.load,
    breakdown: result.breakdown,
    density: result.density,
    flags: result.flags,
    inputsUsed: result.inputsUsed,
  }
  const { error: detErr } = await client
    .from('gym_load_details')
    .upsert({ activity_id: activityId, user_id: act.user_id, model: GYM_LOAD_MODEL_VERSION, computed_at: now, detail: stored })
  if (detErr) throw new Error(detErr.message)
  const { error: upErr } = await client
    .from('activities')
    .update({ training_load: result.load, gym_load_model: GYM_LOAD_MODEL_VERSION, gym_load_at: now, gym_load_stale: false })
    .eq('id', activityId)
  if (upErr) throw new Error(upErr.message)
  return { status: 'stored', load: result.load, result }
}

/**
 * Scores gym sessions that were never scored or are stale (oldest first), at most `limit` per call.
 * `userId` null = every rider (admin). `rescore` also takes rows scored by an older model version.
 * @returns {Promise<{ processed: number, stored: number, noDetail: number, failed: number, remaining: number }>}
 */
export async function backfillGymLoads(client, { userId = null, limit = BACKFILL_BATCH, rescore = false } = {}) {
  const pending = () => {
    let q = client.from('activities').select('id', { count: 'exact' }).eq('activity_type', 'gym')
    if (userId) q = q.eq('user_id', userId)
    const conds = ['gym_load_at.is.null', 'gym_load_stale.is.true']
    if (rescore) conds.push(`gym_load_model.lt.${GYM_LOAD_MODEL_VERSION}`)
    return q.or(conds.join(','))
  }
  const { data, error } = await pending().order('activity_date', { ascending: true }).order('id', { ascending: true }).limit(limit)
  if (error) throw new Error(error.message)
  const out = { processed: 0, stored: 0, noDetail: 0, failed: 0, remaining: 0 }
  for (const row of data || []) {
    out.processed++
    try {
      const r = await computeAndStoreGymLoad(client, row.id)
      if (r.status === 'stored') out.stored++
      else if (r.status === 'no_detail') out.noDetail++
    } catch (err) {
      out.failed++
      console.warn(`Gym load for ${row.id} failed:`, err?.message || err)
    }
  }
  const { count } = await pending().limit(1)
  out.remaining = count ?? 0
  return out
}

/** Import path: score with the service role when configured; a failure never breaks the import (the backfill retries). */
export async function scoreGymBestEffort(activityId, { service } = {}) {
  try {
    const client = service ?? (await import('./connections.js')).getServiceClient()
    if (!client) return null
    return await computeAndStoreGymLoad(client, activityId)
  } catch (err) {
    console.warn(`Gym load for ${activityId} failed:`, err?.message || err)
    return null
  }
}
