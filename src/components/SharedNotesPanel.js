'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCoachModule } from './useCoachModule'
import { fetchSharedNotes, hideSharedNote, NOTE_TAG_LABELS } from '../lib/coachNotes'

// "Notes from my coach": only notes the coach explicitly shared. Hidden entirely when the module is off or there are none.
export default function SharedNotesPanel() {
  const enabled = useCoachModule()
  const [notes, setNotes] = useState([])

  const load = useCallback(async () => {
    const res = await fetchSharedNotes(supabase)
    setNotes(res.notes)
  }, [])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  if (!enabled || notes.length === 0) return null

  const hide = async (id) => {
    const { error } = await hideSharedNote(supabase, id)
    if (!error) load()
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="shared-notes">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Notes from my coach</h2>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {n.title || n.note_date} <span className="font-normal text-slate-500">· {n.coach_name}</span>
              </span>
              <button
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 dark:border-slate-700 text-slate-500"
                onClick={() => hide(n.id)}
              >
                Hide
              </button>
            </div>
            <p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">{n.body}</p>
            {(n.tags || []).length > 0 && (
              <p className="text-[10px] text-slate-500">{n.tags.map((t) => NOTE_TAG_LABELS[t] || t).join(', ')}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
