// Body weight history (issue #143): effective-dated weight per athlete. An activity snapshots
// the weight valid on its date (activities.weight_at_activity_kg); every W/kg figure uses it.

export const WEIGHT_MIN_KG = 20
export const WEIGHT_MAX_KG = 300

function dayOf(date) {
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  const day = String(date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

/** Validates a form entry (kg, one decimal); returns { error } or { entry }. */
export function validateWeightEntry(raw) {
  const date = String(raw?.effective_from || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Enter a valid effective date' }
  }
  const text = String(raw?.weight_kg ?? '').trim().replace(',', '.')
  const n = Number(text)
  const kg = Math.round(n * 10) / 10
  if (text === '' || !Number.isFinite(n) || kg < WEIGHT_MIN_KG || kg > WEIGHT_MAX_KG) {
    return { error: `Weight must be between ${WEIGHT_MIN_KG} and ${WEIGHT_MAX_KG} kg` }
  }
  return { entry: { effective_from: date, weight_kg: kg } }
}

/** History entry valid on `date` (latest effective_from <= date), or null. */
export function resolveWeightAt(history, date) {
  const day = dayOf(date)
  if (!day || !Array.isArray(history)) return null
  let best = null
  for (const h of history) {
    if (!h?.effective_from || h.effective_from > day) continue
    if (!best || h.effective_from > best.effective_from) best = h
  }
  return best
}

function positive(v) {
  const n = Number(v)
  return v != null && Number.isFinite(n) && n > 0 ? n : null
}

/** Weight in kg valid on `date`, or null. */
export function weightAt(history, date) {
  return positive(resolveWeightAt(history, date)?.weight_kg)
}

/** Weight snapshot stored on an activity row, or null. */
export function weightFromActivity(activity) {
  return positive(activity?.weight_at_activity_kg)
}

export async function fetchWeightHistory(supabase, userId) {
  const { data, error } = await supabase
    .from('weight_history')
    .select('id, effective_from, weight_kg')
    .eq('user_id', userId)
    .order('effective_from', { ascending: false })
  return { history: data || [], error }
}

export async function saveWeightEntry(supabase, { userId, entry, id = null }) {
  const row = { ...entry, user_id: userId }
  const q = id
    ? supabase.from('weight_history').update(row).eq('id', id).eq('user_id', userId)
    : supabase.from('weight_history').upsert(row, { onConflict: 'user_id,effective_from' })
  const { error } = await q
  return { error }
}

export async function deleteWeightEntry(supabase, { userId, id }) {
  const { error } = await supabase.from('weight_history').delete().eq('id', id).eq('user_id', userId)
  return { error }
}
