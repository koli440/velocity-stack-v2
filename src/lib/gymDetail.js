// src/lib/gymDetail.js
//
// Gym session detail (issue #326, layer 2): exercises and sets from FIT `set` / `exercise_title` messages
// (api/analyze.py returns them raw as `strength`). Sources without set data (Strava / Intervals summaries)
// have no detail and keep the session summary + HR only. Pure logic plus thin save helpers that work with
// both the browser and the service-role Supabase client.

export const MAX_EXERCISES = 100
export const MAX_SETS = 1000

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
  const del = await supabase.from('gym_exercises').delete().eq('activity_id', ids.activityId)
  if (del.error) return del.error
  return saveGymDetail(supabase, detail, ids)
}

/** Loads exercises with their sets for the detail page (RLS decides visibility). */
export async function fetchGymDetail(supabase, activityId) {
  const [ex, sets] = await Promise.all([
    supabase.from('gym_exercises').select('id, position, name, category, subtype').eq('activity_id', activityId).order('position'),
    supabase.from('gym_sets').select('exercise_id, position, set_type, start_time, duration_s, reps, weight_kg').eq('activity_id', activityId).order('position'),
  ])
  if (ex.error || sets.error || !ex.data?.length) return null
  const byExercise = new Map(ex.data.map((e) => [e.id, { ...e, sets: [] }]))
  for (const s of sets.data || []) byExercise.get(s.exercise_id)?.sets.push(s)
  return { exercises: [...byExercise.values()] }
}
