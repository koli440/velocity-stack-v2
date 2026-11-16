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
import Icon from '../../../../components/Icon'
import { ErrorNote, adminBtn, adminCard, adminInput, adminMuted } from '../../../../components/admin/AdminUi'

const input = `${adminInput} !py-2`
const quiet = adminBtn.secondary

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
    return <p className={`${adminCard} text-sm ${adminMuted}`}>The coach module is not available for your account yet.</p>
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
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">
        Notes{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      <p className={`text-sm ${adminMuted}`}>
        Notes are private to you unless you share them. Unshared notes are deleted 30 days after coaching ends;
        export them before then.
      </p>
      <ErrorNote>{error}</ErrorNote>

      {!readOnly && (
        <form onSubmit={submit} className={`${adminCard} space-y-3`}>
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
                className={draft.tags.includes(t) ? adminBtn.primary : adminBtn.secondary}
              >
                {NOTE_TAG_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-800 dark:text-slate-200">
            <label className="flex items-center gap-2 min-h-[44px] lg:min-h-[32px]">
              <input className="h-5 w-5 accent-orange-600" type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
              Pin
            </label>
            <label className="flex items-center gap-2 min-h-[44px] lg:min-h-[32px]">
              <input
                className="h-5 w-5 accent-orange-600"
                type="checkbox"
                checked={draft.shared_with_rider}
                onChange={(e) => setDraft({ ...draft, shared_with_rider: e.target.checked })}
              />
              Share with athlete
            </label>
            <button type="submit" disabled={busy} className={adminBtn.primary}>
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

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
        <input className={`${input} sm:max-w-xs`} placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className={`${input} sm:max-w-[11rem]`} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
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
        <p className={`text-sm ${adminMuted}`} role="status">Loading…</p>
      ) : visible.length === 0 ? (
        <p className={`${adminCard} text-sm ${adminMuted} text-center`}>No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <li key={n.id} className={`${adminCard} space-y-2`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                  {n.pinned && <Icon name="pin" className="text-orange-600" />}{n.title || n.note_date}
                  {n.shared_with_rider && <span className="rounded-full px-2 py-0.5 text-xs font-bold border bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-100 dark:border-emerald-700">shared</span>}
                </span>
                {!n.read_only && (
                  <span className="flex gap-2">
                    <button className={quiet} onClick={() => setDraft({ ...empty, ...n, tags: n.tags || [] })}>
                      Edit
                    </button>
                    <button className={adminBtn.danger} onClick={() => remove(n.id)}>Delete</button>
                  </span>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{n.body}</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {n.note_date}{(n.tags || []).length ? ` · ${n.tags.map((t) => NOTE_TAG_LABELS[t] || t).join(', ')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
