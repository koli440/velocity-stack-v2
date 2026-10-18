'use client'

import { useState } from 'react'
import { NOTE_TITLE_MAX, NOTE_BODY_MAX, noteAuthorLabel, noteEditedLabel, validateNote } from '../lib/calendarNotes'

// Add / view / edit / delete dialog of a calendar note. `note` is null when adding.
// Both the rider and the rider's active coach may edit and delete any note (the database decides).
export default function CalendarNoteDialog({ note, dayLabel, names, viewerId, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(note?.title || '')
  const [body, setBody] = useState(note?.body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    const v = validateNote({ title, body })
    if (v.error) return setError(v.error)
    setBusy(true)
    setError(null)
    const err = await onSave(v.value)
    setBusy(false)
    if (err) setError(err.message || 'Could not save the note.')
  }

  const remove = async () => {
    if (!window.confirm('Delete this note?')) return
    setBusy(true)
    const err = await onDelete()
    setBusy(false)
    if (err) setError(err.message || 'Could not delete the note.')
  }

  const field = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white'
  const edited = note ? noteEditedLabel(note, names, viewerId) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={note ? 'Calendar note' : 'Add calendar note'}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 shadow-xl"
      >
        <div>
          <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{note ? 'Note' : 'Add note'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dayLabel}
            {note && ` · by ${noteAuthorLabel(note, names, viewerId)}${edited ? ` · ${edited}` : ''}`}
          </p>
        </div>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Title
          <input
            className={field}
            value={title}
            maxLength={NOTE_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Ill, Work trip, Can train Tue/Thu evening"
            autoFocus
          />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Note
          <textarea
            className={`${field} min-h-[6rem]`}
            value={body}
            maxLength={NOTE_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <p className="text-[11px] text-slate-400">Only you and your active coach can see calendar notes.</p>
        {error && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-semibold text-rose-500">{error}</div>}
        <div className="flex items-center justify-between gap-2">
          {note ? (
            <button type="button" disabled={busy} onClick={remove} className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-500 border border-rose-500/40 hover:bg-rose-500/10">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
