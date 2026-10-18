// FTP history (issue #142): effective-dated FTP per athlete. An activity snapshots the FTP valid
// on its date (activities.ftp_at_activity_w); templates always evaluate against that snapshot.

function dayOf(date) {
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  const day = String(date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

/** Validates a form entry; returns { error } or { entry }. */
export function validateFtpEntry(raw) {
  const date = String(raw?.effective_from || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Enter a valid effective date' }
  }
  const text = String(raw?.ftp_w ?? '').trim()
  const n = Number(text)
  if (text === '' || !Number.isFinite(n) || Math.round(n) < 1 || Math.round(n) > 2500) {
    return { error: 'FTP must be between 1 and 2500 W' }
  }
  return { entry: { effective_from: date, ftp_w: Math.round(n) } }
}

/** History entry valid on `date` (latest effective_from <= date), or null. */
export function resolveFtpAt(history, date) {
  const day = dayOf(date)
  if (!day || !Array.isArray(history)) return null
  let best = null
  for (const h of history) {
    if (!h?.effective_from || h.effective_from > day) continue
    if (!best || h.effective_from > best.effective_from) best = h
  }
  return best
}

/** FTP in watts valid on `date`, or null. */
export function ftpAt(history, date) {
  const n = Number(resolveFtpAt(history, date)?.ftp_w)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** FTP snapshot stored on an activity row, or null. */
export function ftpFromActivity(activity) {
  const n = Number(activity?.ftp_at_activity_w)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function fetchFtpHistory(supabase, userId) {
  const { data, error } = await supabase
    .from('ftp_history')
    .select('id, effective_from, ftp_w, changed_by, changed_at, set_by_coach')
    .eq('user_id', userId)
    .order('effective_from', { ascending: false })
  return { history: data || [], error }
}

export async function saveFtpEntry(supabase, { userId, entry, id = null }) {
  const row = { ...entry, user_id: userId }
  const q = id
    ? supabase.from('ftp_history').update(row).eq('id', id).eq('user_id', userId)
    : supabase.from('ftp_history').upsert(row, { onConflict: 'user_id,effective_from' })
  const { error } = await q
  return { error }
}

export async function deleteFtpEntry(supabase, { userId, id }) {
  const { error } = await supabase.from('ftp_history').delete().eq('id', id).eq('user_id', userId)
  return { error }
}
