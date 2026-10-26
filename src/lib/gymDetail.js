// src/lib/gymDetail.js
//
// Gym session detail (issue #326, layer 2): exercises and sets from FIT `set` / `exercise_title` messages
// (api/analyze.py returns them raw as `strength`). Sources without set data (Strava / Intervals summaries)
// have no detail and keep the session summary + HR only. Pure logic plus thin save helpers that work with
// both the browser and the service-role Supabase client.

export const MAX_EXERCISES = 100
export const MAX_SETS = 1000

const SET_COLUMNS = 'exercise_id, position, set_type, start_time, duration_s, reps, weight_kg, kind, rest_s, rpe, rir, tempo, side, load_mode, notes, metrics'

import { scopeToOwner } from './ownerScope.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function humanize(value) {
  const s = String(value ?? '').trim()
  if (!s || /^\d+$/.test(s)) return null
  const text = s.replace(/_/g, ' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function titleFor(titles, category, subtype) {
  const list = Array.isArray(titles) ? titles.filter((t) => t?.title) : []
  const exact = list.find((t) => t.category === category && subtype != null && String(t.name_id) === String(subtype))
  return (exact || list.find((t) => t.category === category))?.title || null
}

/**
 * Group the raw set list into exercises (consecutive active sets of the same category / subtype).
 * Rest sets stay in the exercise they follow. Returns null when there are no active sets.
 * @param {{ sets?: object[], titles?: object[] }|null|undefined} strength
 * @returns {{ exercises: Array<{ name: string, category: string|null, subtype: string|null, sets: object[] }> }|null}
 */
export function buildGymDetail(strength) {
  const rawSets = Array.isArray(strength?.sets) ? strength.sets.slice(0, MAX_SETS) : []
  const ordered = rawSets.every((s) => isNum(s?.index))
    ? [...rawSets].sort((a, b) => a.index - b.index)
    : rawSets
  const exercises = []
  let current = null
  for (const s of ordered) {
    if (!s || typeof s !== 'object') continue
    const type = s.type === 'rest' ? 'rest' : 'active'
    const set = {
      set_type: type,
      start_time: s.start_time || null,
      duration_s: isNum(s.duration_s) ? s.duration_s : null,
      reps: isNum(s.reps) ? Math.round(s.reps) : null,
      weight_kg: isNum(s.weight_kg) ? s.weight_kg : null,
    }
    if (type === 'rest') {
      if (current) current.sets.push(set)
      continue
    }
    const category = s.category || null
    const subtype = s.subtype || null
    if (!current || current.category !== category || current.subtype !== subtype) {
      if (exercises.length >= MAX_EXERCISES) break
      current = {
        name: titleFor(strength.titles, category, subtype) || humanize(subtype) || humanize(category) || 'Exercise',
        category,
        subtype,
        sets: [],
      }
      exercises.push(current)
    }
    current.sets.push(set)
  }
  return exercises.length ? { exercises } : null
}

/** Active sets only. */
export const activeSets = (exercise) => (exercise?.sets || []).filter((s) => s.set_type !== 'rest')

/** Seconds of rest recorded after the given set (the rest set that directly follows it), else null. */
export function restAfter(exercise, index) {
  const own = exercise?.sets?.[index]?.rest_s
  if (isNum(own)) return own
  const next = exercise?.sets?.[index + 1]
  return next?.set_type === 'rest' && isNum(next.duration_s) ? next.duration_s : null
}

/** Totals over a detail shaped like buildGymDetail's result (or the rows the UI loads). */
export function gymTotals(detail) {
  let sets = 0
  let reps = 0
  let volumeKg = 0
  for (const ex of detail?.exercises || []) {
    for (const s of activeSets(ex)) {
      sets++
      reps += s.reps || 0
      volumeKg += (s.reps || 0) * (s.weight_kg || 0)
    }
  }
  return { exercises: detail?.exercises?.length || 0, sets, reps, volumeKg: Math.round(volumeKg * 10) / 10 }
}

/** Table rows for gym_exercises / gym_sets. `newId` is injectable for tests. */
export function gymDetailRows(detail, { activityId, userId, newId = () => globalThis.crypto.randomUUID() }) {
  const exerciseRows = []
  const setRows = []
  let position = 0
  ;(detail?.exercises || []).forEach((ex, i) => {
    const id = newId()
    exerciseRows.push({ id, activity_id: activityId, user_id: userId, position: i, name: ex.name, category: ex.category, subtype: ex.subtype })
    for (const s of ex.sets) {
      setRows.push({
        activity_id: activityId,
        user_id: userId,
        exercise_id: id,
        position: position++,
        set_type: s.set_type,
        start_time: s.start_time,
        duration_s: s.duration_s,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })
    }
  })
  return { exerciseRows, setRows }
}

/** Inserts the detail rows. Returns the Supabase error, if any (nothing to do for a null detail). */
export async function saveGymDetail(supabase, detail, ids) {
  const { exerciseRows, setRows } = gymDetailRows(detail, ids)
  if (!exerciseRows.length) return null
  const ex = await supabase.from('gym_exercises').insert(exerciseRows)
  if (ex.error) return ex.error
  const sets = await supabase.from('gym_sets').insert(setRows)
  return sets.error || null
}

/** Replaces any stored detail of the activity (gym_sets follow gym_exercises on delete). */
export async function replaceGymDetail(supabase, detail, ids) {
  if (await isGymEdited(supabase, ids.activityId)) return null
  const del = await supabase.from('gym_exercises').delete().eq('activity_id', ids.activityId)
  if (del.error) return del.error
  return saveGymDetail(supabase, detail, ids)
}

/** Loads exercises with their sets for the detail page (RLS decides visibility). */
export async function fetchGymDetail(supabase, activityId) {
  const [ex, sets] = await Promise.all([
    supabase.from('gym_exercises').select('id, position, name, category, subtype, notes').eq('activity_id', activityId).order('position'),
    supabase.from('gym_sets').select(SET_COLUMNS).eq('activity_id', activityId).order('position'),
  ])
  if (ex.error || sets.error || !ex.data?.length) return null
  const byExercise = new Map(ex.data.map((e) => [e.id, { ...e, sets: [] }]))
  for (const s of sets.data || []) byExercise.get(s.exercise_id)?.sets.push(s)
  return { exercises: [...byExercise.values()] }
}

// ---- Editing (issue #335) -------------------------------------------------------------------------------

export const SET_KINDS = Object.freeze(['working', 'warmup', 'drop', 'failure'])
export const SET_KIND_LABELS = Object.freeze({ working: 'Working', warmup: 'Warm-up', drop: 'Drop', failure: 'Failure' })
export const LOAD_MODES = Object.freeze(['weighted', 'bodyweight', 'assisted'])
export const LOAD_MODE_LABELS = Object.freeze({ weighted: 'Weighted', bodyweight: 'Bodyweight', assisted: 'Assisted' })
export const SIDES = Object.freeze(['left', 'right'])
export const VELOCITY_FIELDS = Object.freeze([
  { key: 'mean_velocity_ms', label: 'Mean vel (m/s)', min: 0, max: 10 },
  { key: 'peak_velocity_ms', label: 'Peak vel (m/s)', min: 0, max: 20 },
  { key: 'velocity_loss_pct', label: 'Vel loss (%)', min: 0, max: 100 },
  { key: 'rom_cm', label: 'ROM (cm)', min: 0, max: 500 },
])
const TEMPO_RE = /^[0-9Xx]{1,2}(-[0-9Xx]{1,2}){2,3}$/
export const KG_PER_LB = 0.45359237

export const kgToUnit = (kg, unit) => (kg == null ? null : unit === 'lb' ? Math.round((kg / KG_PER_LB) * 10) / 10 : kg)
export const unitToKg = (v, unit) => (v == null ? null : unit === 'lb' ? Math.round(v * KG_PER_LB * 1000) / 1000 : v)

/** Loaded kg of a set for volume / 1RM: bodyweight-only sets and assisted sets carry no external load. */
const externalKg = (s) => (s.load_mode === 'weighted' || !s.load_mode ? s.weight_kg || 0 : 0)

/** Reps x weight (kg) of an active set; 0 when either is missing or the set is not an external load. */
export const setVolume = (s) => (s?.reps || 0) * externalKg(s || {})

/** Estimated 1RM, an ESTIMATE: Epley, or Brzycki for 2-10 reps when asked. Null above 12 reps / without load. */
export function estimate1RM(weightKg, reps, formula = 'epley') {
  if (!isNum(weightKg) || !isNum(reps) || weightKg <= 0 || reps < 1 || reps > 12) return null
  if (reps === 1) return weightKg
  const v = formula === 'brzycki' ? (weightKg * 36) / (37 - reps) : weightKg * (1 + reps / 30)
  return Math.round(v * 10) / 10
}

/** Best (highest e1RM) working-type set of an exercise; warm-ups never count. */
export function bestSet(exercise, formula = 'epley') {
  let best = null
  for (const s of activeSets(exercise)) {
    if (s.kind === 'warmup') continue
    const e1rm = estimate1RM(externalKg(s), s.reps, formula)
    if (e1rm != null && (!best || e1rm > best.e1rm)) best = { set: s, e1rm }
  }
  return best
}

/** Totals for the session summary (warm-ups count towards sets / reps / volume, tonnage = volume). */
export function gymSummary(detail) {
  const t = gymTotals({ exercises: (detail?.exercises || []).map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight_kg: externalKg(s) })) })) })
  return t
}

/** Exercise names the rider used before, most frequent first, for the suggestion list. */
export function suggestExerciseNames(history, query = '', limit = 8) {
  const counts = new Map()
  for (const n of history || []) {
    const name = String(n || '').trim().replace(/\s+/g, ' ')
    if (!name) continue
    const key = name.toLowerCase()
    const cur = counts.get(key) || { name, n: 0 }
    cur.n++
    counts.set(key, cur)
  }
  const q = String(query || '').trim().toLowerCase()
  return [...counts.entries()]
    .filter(([key]) => !q || key.includes(q))
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([, v]) => v.name)
}

export const blankSet = (over = {}) => ({
  kind: 'working', reps: null, weight_kg: null, duration_s: null, rest_s: null, rpe: null, rir: null,
  tempo: null, side: null, load_mode: 'weighted', notes: null, metrics: {}, start_time: null, ...over,
})

/** A copy of a set for "copy previous set" / "+1 set" (notes and timing are not carried over). */
export const copySet = (s) => blankSet({ ...s, notes: null, start_time: null, metrics: {} })

/** Editable working copy of a loaded detail: active sets only, each rest folded into rest_s of its set. */
export function toEditable(detail) {
  return (detail?.exercises || []).map((ex) => ({
    name: ex.name, category: ex.category ?? null, subtype: ex.subtype ?? null, notes: ex.notes ?? null,
    sets: (ex.sets || []).flatMap((s, i) => s.set_type === 'rest' ? [] : [blankSet({
      kind: s.kind || 'working', reps: s.reps ?? null, weight_kg: s.weight_kg ?? null, duration_s: s.duration_s ?? null,
      rest_s: restAfter(ex, i), rpe: s.rpe ?? null, rir: s.rir ?? null, tempo: s.tempo ?? null, side: s.side ?? null,
      load_mode: s.load_mode || 'weighted', notes: s.notes ?? null, metrics: { ...(s.metrics || {}) }, start_time: s.start_time ?? null,
    })]),
  }))
}

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

/** Validates and normalises the editor state for save_gym_session. @returns {{ exercises?: object[], error?: string }} */
export function buildSavePayload(editable) {
  const list = Array.isArray(editable) ? editable : []
  if (list.length > MAX_EXERCISES) return { error: `At most ${MAX_EXERCISES} exercises` }
  let total = 0
  const exercises = []
  for (const [i, ex] of list.entries()) {
    const name = String(ex.name || '').trim()
    if (!name) return { error: `Exercise ${i + 1} needs a name` }
    if (name.length > 120) return { error: `Exercise ${i + 1}: name is too long (max 120)` }
    if (String(ex.notes || '').length > 1000) return { error: `${name}: notes are too long (max 1000)` }
    const sets = []
    for (const [j, s] of (ex.sets || []).entries()) {
      const where = `${name}, set ${j + 1}`
      const reps = numOrNull(s.reps), weight = numOrNull(s.weight_kg), dur = numOrNull(s.duration_s), rest = numOrNull(s.rest_s)
      const rpe = numOrNull(s.rpe), rir = numOrNull(s.rir)
      if (reps != null && (!Number.isInteger(reps) || reps < 0 || reps >= 10000)) return { error: `${where}: reps must be a whole number` }
      if (weight != null && (weight < 0 || weight >= 4000)) return { error: `${where}: weight is out of range` }
      if (dur != null && (dur < 0 || dur >= 86400)) return { error: `${where}: duration is out of range` }
      if (rest != null && (rest < 0 || rest >= 86400)) return { error: `${where}: rest is out of range` }
      if (rpe != null && (rpe < 1 || rpe > 10 || (rpe * 2) % 1 !== 0)) return { error: `${where}: RPE must be 1-10 in steps of 0.5` }
      if (rir != null && (rir < 0 || rir > 10 || (rir * 2) % 1 !== 0)) return { error: `${where}: RIR must be 0-10 in steps of 0.5` }
      const tempo = String(s.tempo || '').trim() || null
      if (tempo && !TEMPO_RE.test(tempo)) return { error: `${where}: tempo looks like 3-1-1-0` }
      if (!SET_KINDS.includes(s.kind || 'working')) return { error: `${where}: unknown set type` }
      if (!LOAD_MODES.includes(s.load_mode || 'weighted')) return { error: `${where}: unknown load type` }
      if (s.side && !SIDES.includes(s.side)) return { error: `${where}: side must be left or right` }
      if (String(s.notes || '').length > 500) return { error: `${where}: notes are too long (max 500)` }
      const metrics = { ...(s.metrics || {}) }
      for (const f of VELOCITY_FIELDS) {
        const v = numOrNull(metrics[f.key])
        if (v == null) delete metrics[f.key]
        else if (v < f.min || v > f.max) return { error: `${where}: ${f.label} is out of range` }
        else metrics[f.key] = v
      }
      sets.push({
        kind: s.kind || 'working', reps, weight_kg: weight, duration_s: dur, rest_s: rest, rpe, rir, tempo,
        side: s.side || null, load_mode: s.load_mode || 'weighted', notes: String(s.notes || '').trim() || null,
        start_time: s.start_time || null, metrics,
      })
    }
    total += sets.length
    if (total > MAX_SETS) return { error: `At most ${MAX_SETS} sets` }
    exercises.push({ name, category: ex.category || null, subtype: ex.subtype || null, notes: String(ex.notes || '').trim() || null, sets })
  }
  return { exercises }
}

/** Saves an edit through the audited RPC (rider or active coach). */
export async function saveGymSession(client, activityId, editable) {
  const { exercises, error } = buildSavePayload(editable)
  if (error) return { data: null, error: new Error(error) }
  const { data, error: rpcError } = await client.rpc('save_gym_session', { p_activity: activityId, p_exercises: exercises })
  return { data: rpcError ? null : data, error: rpcError || null }
}

/** True when the detail of the activity was edited by hand (re-imports must leave it alone). */
export async function isGymEdited(client, activityId) {
  const { data } = await client.from('gym_session_edits').select('activity_id').eq('activity_id', activityId).maybeSingle()
  return Boolean(data)
}

/** Who edited the detail last: { edited_at, edited_by, edited_by_coach } or null. */
export async function fetchGymEditStamp(client, activityId) {
  const { data } = await client.from('gym_session_edits').select('edited_at, edited_by, edited_by_coach').eq('activity_id', activityId).maybeSingle()
  return data || null
}

/** The signed-in rider's previous exercise names (own account: explicitly owner-scoped), newest first. */
export async function fetchExerciseNameHistory(client, ownerId, limit = 500) {
  const { data } = await scopeToOwner(client.from('gym_exercises').select('name'), ownerId).order('created_at', { ascending: false }).limit(limit)
  return (data || []).map((r) => r.name)
}

/** Sets of the rider's most recent earlier session containing the exercise, for "repeat last session". */
export async function fetchLastSessionSets(client, ownerId, name, excludeActivityId) {
  const key = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!key) return []
  let q = scopeToOwner(client.from('gym_exercises').select('id, activity_id, created_at'), ownerId).eq('name_key', key)
  if (excludeActivityId) q = q.neq('activity_id', excludeActivityId)
  const { data: exs } = await q.order('created_at', { ascending: false }).limit(1)
  if (!exs?.length) return []
  const { data } = await client.from('gym_sets').select(SET_COLUMNS).eq('exercise_id', exs[0].id).order('position')
  return toEditable({ exercises: [{ name, sets: data || [] }] })[0]?.sets || []
}
