'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useAthlete } from '../../../../components/AthleteContext'
import { useCoachModule } from '../../../../components/useCoachModule'
import {
  NOTE_TAGS,
  NOTE_TAG_LABELS,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  validateNote,
  filterNotes,
  notesToText,
  coachNoteErrorMessage,
  fetchCoachNotes,
  saveCoachNote,
  deleteCoachNote,
} from '../../../../lib/coachNotes'

const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm'
const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'
const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-500`

const empty = { id: null, title: '', body: '', tags: [], pinned: false, shared_with_rider: false }

// Private coach notes about an athlete. Reads/writes only via RPCs; unshared notes are never visible to the athlete.
export default function AthleteNotesPage() {
  const { riderId, athlete } = useAthlete()
  const enabled = useCoachModule()
  const [notes, setNotes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState(empty)
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!riderId) return
    const res = await fetchCoachNotes(supabase, riderId)
    if (res.error) setError(coachNoteErrorMessage(res.error))
    setNotes(res.notes)
    setLoaded(true)
  }, [riderId])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  const visible = useMemo(() => filterNotes(notes, { tag, query }), [notes, tag, query])

  if (!riderId) return null
  if (!enabled) {
    return <p className="text-sm text-slate-500">The coach module is not available for your account yet.</p>
  }

  const readOnly = notes.some((n) => n.read_only)

  const submit = async (e) => {
    e.preventDefault()
    const problem = validateNote(draft)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const { error: err } = await saveCoachNote(supabase, { ...draft, rider_id: riderId })
    setBusy(false)
    if (err) return setError(coachNoteErrorMessage(err))
    setDraft(empty)
    load()
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this note?')) return
    const { error: err } = await deleteCoachNote(supabase, id)
    if (err) setError(coachNoteErrorMessage(err))
    else load()
  }

  const exportText = () => {
    const blob = new Blob([notesToText(notes, athlete?.display_name)], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'coach-notes.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const toggleTag = (t) =>
    setDraft((d) => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] }))

  return (
    <div className="space-y-4" data-testid="athlete-notes">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        Notes{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      <p className="text-xs text-slate-500">
        Notes are private to you unless you share them. Unshared notes are deleted 30 days after coaching ends;
        export them before then.
      </p>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}

      {!readOnly && (
        <form onSubmit={submit} className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <input
            className={input}
            placeholder="Title (optional)"
            maxLength={NOTE_TITLE_MAX}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            className={input}
            rows={4}
            placeholder="Write a note…"
            maxLength={NOTE_BODY_MAX}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            {NOTE_TAGS.map((t) => (
              <button
                type="button"
                key={t}
                aria-pressed={draft.tags.includes(t)}
                onClick={() => toggleTag(t)}
                className={`${btn} ${draft.tags.includes(t) ? 'border-orange-500 text-orange-500' : 'border-slate-300 dark:border-slate-700 text-slate-500'}`}
              >
                {NOTE_TAG_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
              Pin
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.shared_with_rider}
                onChange={(e) => setDraft({ ...draft, shared_with_rider: e.target.checked })}
              />
              Share with athlete
            </label>
            <button type="submit" disabled={busy} className={`${btn} border-orange-500/40 text-orange-500 hover:bg-orange-500/10`}>
              {draft.id ? 'Save changes' : 'Add note'}
            </button>
            {draft.id && (
              <button type="button" className={quiet} onClick={() => setDraft(empty)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input className={`${input} max-w-xs`} placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={`${input} max-w-[10rem]`} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {NOTE_TAGS.map((t) => (
            <option key={t} value={t}>{NOTE_TAG_LABELS[t]}</option>
          ))}
        </select>
        <button type="button" className={quiet} onClick={exportText} disabled={!notes.length}>
          Export
        </button>
      </div>

      {!loaded ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-slate-500">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <li key={n.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {n.pinned ? '📌 ' : ''}{n.title || n.note_date}
                  {n.shared_with_rider && <span className="ml-2 text-[10px] text-emerald-600">shared</span>}
                </span>
                {!n.read_only && (
                  <span className="flex gap-2">
                    <button className={quiet} onClick={() => setDraft({ ...empty, ...n, tags: n.tags || [] })}>
                      Edit
                    </button>
                    <button className={`${btn} border-red-400/40 text-red-500`} onClick={() => remove(n.id)}>Delete</button>
                  </span>
                )}
              </div>
              <p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">{n.body}</p>
              <p className="text-[10px] text-slate-500">
                {n.note_date}{(n.tags || []).length ? ` · ${n.tags.map((t) => NOTE_TAG_LABELS[t] || t).join(', ')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
