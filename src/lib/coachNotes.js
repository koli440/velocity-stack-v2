// Coach notes (docs/coaching.md). Every read and write goes through SECURITY DEFINER RPCs
// (supabase/migrations/20270151000000_coach_module_flag_and_notes.sql); the table is not client accessible.

export const NOTE_TAGS = Object.freeze(['injury', 'goal', 'feedback', 'admin', 'other'])
export const NOTE_TAG_LABELS = Object.freeze({
  injury: 'Injury',
  goal: 'Goal',
  feedback: 'Feedback',
  admin: 'Admin',
  other: 'Other',
})
export const NOTE_BODY_MAX = 4000
export const NOTE_TITLE_MAX = 80
export const NOTES_EXPORT_WINDOW_DAYS = 30

/** Client-side mirror of the SQL validation. Returns an error string or null. */
export function validateNote(note) {
  const title = String(note?.title ?? '').trim()
  const body = String(note?.body ?? '').trim()
  if (!body) return 'Write something first.'
  if (body.length > NOTE_BODY_MAX) return `A note can have at most ${NOTE_BODY_MAX} characters.`
  if (title.length > NOTE_TITLE_MAX) return `The title can have at most ${NOTE_TITLE_MAX} characters.`
  if ((note?.tags || []).some((t) => !NOTE_TAGS.includes(t))) return 'Unknown tag.'
  return null
}

/** Applies the tag / text filters of the notes page. Pinned notes stay first. */
export function filterNotes(notes, { tag = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (notes || [])
    .filter((n) => !tag || (n.tags || []).includes(tag))
    .filter((n) => !q || `${n.title || ''}\n${n.body || ''}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.note_date).localeCompare(String(a.note_date)))
}

/** Plain-text export of the coach's notes about an athlete. */
export function notesToText(notes, athleteName) {
  const head = `Coach notes: ${athleteName || 'athlete'}`
  const body = (notes || [])
    .map((n) => {
      const tags = (n.tags || []).length ? ` [${n.tags.join(', ')}]` : ''
      const title = n.title ? ` ${n.title}` : ''
      return `${n.note_date}${title}${tags}${n.shared_with_rider ? ' (shared with athlete)' : ''}\n${n.body}`
    })
    .join('\n\n---\n\n')
  return `${head}\n${'='.repeat(head.length)}\n\n${body}\n`
}

/** Whole days left of the export window (never negative). */
export function exportDaysLeft(expiresAt, now = new Date()) {
  const ms = new Date(expiresAt).getTime() - new Date(now).getTime()
  return Math.max(0, Math.ceil(ms / 86400000))
}

export function coachNoteErrorMessage(error) {
  const msg = String(error?.message || '')
  if (/not enabled/i.test(msg)) return 'The coach module is not available for your account yet.'
  if (/Too many/i.test(msg)) return msg
  if (/not coaching/i.test(msg)) return 'You are not coaching this rider.'
  if (/stay with the rider/i.test(msg)) return 'Shared notes stay with the athlete after coaching ended.'
  if (/No such note/i.test(msg)) return 'This note no longer exists.'
  return 'Something went wrong. Please try again.'
}

export async function fetchCoachNotes(client, riderId) {
  const { data, error } = await client.rpc('coach_notes_list', { p_rider: riderId })
  return { notes: error ? [] : data || [], error }
}

export async function saveCoachNote(client, note) {
  const { data, error } = await client.rpc('coach_note_save', {
    p: {
      id: note.id || null,
      rider_id: note.rider_id,
      note_date: note.note_date || null,
      title: note.title || '',
      body: note.body,
      tags: note.tags || [],
      pinned: !!note.pinned,
      shared_with_rider: !!note.shared_with_rider,
      activity_id: note.activity_id || null,
      planned_workout_id: note.planned_workout_id || null,
    },
  })
  return { id: data || null, error }
}

export async function deleteCoachNote(client, id) {
  const { error } = await client.rpc('coach_note_delete', { p_id: id })
  return { error }
}

export async function fetchSharedNotes(client) {
  const { data, error } = await client.rpc('my_shared_notes')
  return { notes: error ? [] : data || [], error }
}

export async function hideSharedNote(client, id) {
  const { error } = await client.rpc('hide_shared_note', { p_id: id })
  return { error }
}
