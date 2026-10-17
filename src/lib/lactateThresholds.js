// Lactate thresholds (issue #121): LT1/LT2 as power (W) and heart rate (bpm), effective-dated.
// An activity snapshots the entry valid at its date (columns *_at_activity*), set by a DB trigger.

export const LT_SNAPSHOT_COLUMNS = [
  'lt1_power_at_activity_w',
  'lt1_hr_at_activity',
  'lt2_power_at_activity_w',
  'lt2_hr_at_activity',
]

const FIELD_LIMITS = {
  lt1_power_w: [1, 2500],
  lt2_power_w: [1, 2500],
  lt1_hr: [30, 250],
  lt2_hr: [30, 250],
}

function toIntOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : NaN
}

/** Validates a form entry; returns { error } or { entry } with numbers/nulls. */
export function validateLtEntry(raw) {
  const date = String(raw?.effective_from || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Enter a valid effective date' }
  }
  const entry = { effective_from: date }
  for (const [key, [min, max]] of Object.entries(FIELD_LIMITS)) {
    const v = toIntOrNull(raw?.[key])
    if (Number.isNaN(v) || (v != null && (v < min || v > max))) {
      const label = key.replace(/_w$/, '').replace('_', ' ').toUpperCase()
      return { error: `${label} must be between ${min} and ${max}` }
    }
    entry[key] = v
  }
  if (Object.keys(FIELD_LIMITS).every((k) => entry[k] == null)) {
    return { error: 'Enter at least one threshold value' }
  }
  if (entry.lt1_power_w != null && entry.lt2_power_w != null && entry.lt1_power_w >= entry.lt2_power_w) {
    return { error: 'LT1 power must be lower than LT2 power' }
  }
  if (entry.lt1_hr != null && entry.lt2_hr != null && entry.lt1_hr >= entry.lt2_hr) {
    return { error: 'LT1 HR must be lower than LT2 HR' }
  }
  return { entry }
}

function dayOf(date) {
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  return String(date || '').slice(0, 10)
}

/** History entry valid on `date` (latest effective_from <= date), or null. */
export function resolveLtAt(history, date) {
  const day = dayOf(date)
  if (!day || !Array.isArray(history)) return null
  let best = null
  for (const h of history) {
    if (!h?.effective_from || h.effective_from > day) continue
    if (!best || h.effective_from > best.effective_from) best = h
  }
  return best
}

/** Normalised thresholds: { lt1Power, lt1Hr, lt2Power, lt2Hr } (numbers or null), or null if none. */
export function ltFromHistoryEntry(entry) {
  if (!entry) return null
  return normalizeLt({
    lt1Power: entry.lt1_power_w,
    lt1Hr: entry.lt1_hr,
    lt2Power: entry.lt2_power_w,
    lt2Hr: entry.lt2_hr,
  })
}

/** Thresholds stored on an activity row (snapshot), or null when it has none. */
export function ltFromActivity(activity) {
  if (!activity) return null
  return normalizeLt({
    lt1Power: activity.lt1_power_at_activity_w,
    lt1Hr: activity.lt1_hr_at_activity,
    lt2Power: activity.lt2_power_at_activity_w,
    lt2Hr: activity.lt2_hr_at_activity,
  })
}

function normalizeLt(lt) {
  const out = {}
  for (const [k, v] of Object.entries(lt)) {
    const n = v == null ? null : Number(v)
    out[k] = Number.isFinite(n) && n > 0 ? n : null
  }
  return Object.values(out).some((v) => v != null) ? out : null
}

export async function fetchLtHistory(supabase, userId) {
  const { data, error } = await supabase
    .from('lactate_threshold_history')
    .select('id, effective_from, lt1_power_w, lt1_hr, lt2_power_w, lt2_hr, changed_by, changed_at, set_by_coach')
    .eq('user_id', userId)
    .order('effective_from', { ascending: false })
  return { history: data || [], error }
}

export async function saveLtEntry(supabase, { userId, entry, id = null }) {
  const row = { ...entry, user_id: userId }
  const q = id
    ? supabase.from('lactate_threshold_history').update(row).eq('id', id).eq('user_id', userId)
    : supabase.from('lactate_threshold_history').upsert(row, { onConflict: 'user_id,effective_from' })
  const { error } = await q
  return { error }
}

export async function deleteLtEntry(supabase, { userId, id }) {
  const { error } = await supabase.from('lactate_threshold_history').delete().eq('id', id).eq('user_id', userId)
  return { error }
}

/**
 * Seconds spent per LT zone in a ~1 Hz stream. Zones: below LT1 (v < lt1), between
 * (lt1 <= v < lt2) and above LT2 (v >= lt2). With only one threshold known the stream is
 * split into two zones around it. Returns [] when there is no stream or no threshold.
 */
export function lactateZoneBreakdown(stream, lt1, lt2) {
  if (!Array.isArray(stream)) return []
  const t1 = lt1 > 0 ? lt1 : null
  const t2 = lt2 > 0 ? lt2 : null
  if (t1 == null && t2 == null) return []
  let below = 0
  let between = 0
  let above = 0
  let any = false
  for (const raw of stream) {
    if (raw == null || !Number.isFinite(Number(raw))) continue
    any = true
    const v = Number(raw)
    if (t1 != null && v < t1) below++
    else if (t2 != null && v >= t2) above++
    else if (t1 != null && t2 != null) between++
    else if (t1 != null) above++
    else below++
  }
  if (!any) return []
  if (t1 != null && t2 != null) {
    return [
      { id: 'below_lt1', label: 'Below LT1', seconds: below },
      { id: 'lt1_lt2', label: 'LT1–LT2', seconds: between },
      { id: 'above_lt2', label: 'Above LT2', seconds: above },
    ]
  }
  const name = t1 != null ? 'LT1' : 'LT2'
  return [
    { id: `below_${name.toLowerCase()}`, label: `Below ${name}`, seconds: below },
    { id: `above_${name.toLowerCase()}`, label: `Above ${name}`, seconds: above },
  ]
}

/** Summary for the activity page: threshold values plus time-in-zone for power and HR. */
export function activityLtSummary(activity) {
  const lt = ltFromActivity(activity)
  if (!lt) return null
  const ts = activity?.time_series || {}
  return {
    lt,
    power: lactateZoneBreakdown(ts.watts, lt.lt1Power, lt.lt2Power),
    hr: lactateZoneBreakdown(ts.heartrate, lt.lt1Hr, lt.lt2Hr),
  }
}

/**
 * Seconds a stream spends in one LT zone: `below_lt1` (v < LT1), `lt1_lt2` (LT1 <= v < LT2) or
 * `above_lt2` (v >= LT2). Returns null when the zone's thresholds are unknown or the stream is empty.
 */
export function secondsInLtZone(stream, zone, lt1, lt2) {
  const t1 = lt1 > 0 ? lt1 : null
  const t2 = lt2 > 0 ? lt2 : null
  if (!Array.isArray(stream) || !stream.length) return null
  if ((zone === 'below_lt1' || zone === 'lt1_lt2') && t1 == null) return null
  if ((zone === 'above_lt2' || zone === 'lt1_lt2') && t2 == null) return null
  let count = 0
  let any = false
  for (const raw of stream) {
    if (raw == null || !Number.isFinite(Number(raw))) continue
    any = true
    const v = Number(raw)
    if (zone === 'below_lt1' ? v < t1 : zone === 'above_lt2' ? v >= t2 : v >= t1 && v < t2) count++
  }
  return any ? count : null
}
