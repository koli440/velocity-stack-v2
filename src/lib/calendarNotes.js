// Pure logic for calendar notes (supabase/migrations/20261205000000_calendar_notes.sql): short
// day notes on a rider's calendar, written by the rider or the rider's active coach.
// The database enforces access, limits and the author stamps; this module only validates input
// for friendly errors, derives labels and groups notes per day.

export const NOTE_TITLE_MAX = 80
export const NOTE_BODY_MAX = 1000
export const NOTE_COLUMNS = 'id, rider_id, note_date, title, body, created_by, updated_by, set_by_coach, created_at, updated_at'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Trims and validates a draft; returns { value: {title, body} } or { error }. */
export function validateNote({ title, body } = {}) {
  const t = String(title ?? '').trim()
  const b = String(body ?? '').trim()
  if (!t) return { error: 'Add a title.' }
  if (t.length > NOTE_TITLE_MAX) return { error: `Title is limited to ${NOTE_TITLE_MAX} characters.` }
  if (b.length > NOTE_BODY_MAX) return { error: `Note is limited to ${NOTE_BODY_MAX} characters.` }
  return { value: { title: t, body: b } }
}

export function isDayKey(value) {
  return typeof value === 'string' && DAY_RE.test(value)
}

/**
 * "Amy", "You" or "former coach". Coach-written notes whose author is no longer identifiable
 * (account deleted, or no readable name) are "former coach"; a rider's note is "Rider" when unknown.
 * `names` maps profile id -> display name.
 */
export function noteAuthorLabel(note, names = {}, viewerId = null) {
  if (!note) return ''
  if (viewerId && note.created_by === viewerId) return 'You'
  const name = note.created_by ? names[note.created_by] : null
  if (name) return name
  return note.set_by_coach ? 'former coach' : 'Rider'
}

/** Extra "edited by X" label when someone other than the author last changed the note. */
export function noteEditedLabel(note, names = {}, viewerId = null) {
  if (!note || note.updated_by === note.created_by) return null
  if (note.updated_by && viewerId && note.updated_by === viewerId) return 'edited by You'
  const name = note.updated_by ? names[note.updated_by] : null
  if (name) return `edited by ${name}`
  // updated_by is NULL after the account was deleted: only a coach can have been the editor
  // when the note was written by the rider.
  return note.updated_by ? 'edited' : note.set_by_coach ? null : 'edited by former coach'
}

/** Profile ids whose names are needed to label these notes. */
export function noteProfileIds(notes) {
  const ids = new Set()
  for (const n of notes || []) {
    if (n.created_by) ids.add(n.created_by)
    if (n.updated_by) ids.add(n.updated_by)
  }
  return [...ids]
}

/** Groups notes by their "YYYY-MM-DD" day, oldest first within a day. */
export function groupNotesByDay(notes) {
  const map = {}
  for (const n of notes || []) {
    if (!n || !isDayKey(n.note_date)) continue
    ;(map[n.note_date] ||= []).push(n)
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  }
  return map
}

/**
 * Fetches the rider's notes of the visible grid range (inclusive day keys). RLS limits the result
 * to the rider and the rider's active coach; nobody else gets rows.
 */
export async function fetchNotesInRange(client, { riderId, startDay, endDay }) {
  if (!riderId || !isDayKey(startDay) || !isDayKey(endDay)) return { data: [], error: null }
  const { data, error } = await client
    .from('calendar_notes')
    .select(NOTE_COLUMNS)
    .eq('rider_id', riderId)
    .gte('note_date', startDay)
    .lte('note_date', endDay)
    .order('note_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: [], error }
  return { data: data || [], error: null }
}

// Writes send only the client-writable columns; the database stamps author fields itself.
export async function createNote(client, { riderId, day, title, body }) {
  const v = validateNote({ title, body })
  if (v.error) return { data: null, error: new Error(v.error) }
  if (!riderId || !isDayKey(day)) return { data: null, error: new Error('Pick a day.') }
  const { data, error } = await client
    .from('calendar_notes')
    .insert({ rider_id: riderId, note_date: day, ...v.value })
    .select(NOTE_COLUMNS)
    .single()
  return { data, error }
}

export async function updateNote(client, id, { day, title, body }) {
  const v = validateNote({ title, body })
  if (v.error) return { data: null, error: new Error(v.error) }
  if (!id || !isDayKey(day)) return { data: null, error: new Error('Pick a day.') }
  const { data, error } = await client
    .from('calendar_notes')
    .update({ note_date: day, ...v.value })
    .eq('id', id)
    .select(NOTE_COLUMNS)
    .maybeSingle()
  if (!error && !data) return { data: null, error: new Error('Note not found or no longer editable.') }
  return { data, error }
}

export async function deleteNote(client, id) {
  const { data, error } = await client.from('calendar_notes').delete().eq('id', id).select('id')
  if (!error && !(data || []).length) return { error: new Error('Note not found or no longer editable.') }
  return { error }
}
