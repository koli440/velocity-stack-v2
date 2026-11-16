'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'
import { adminBtn } from './admin/AdminUi'
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
    <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6 space-y-4" data-testid="shared-notes">
      <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2"><Icon name="notes" /> Notes from my coach</h2>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="space-y-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {n.title || n.note_date} <span className="font-normal text-slate-600 dark:text-slate-300">· {n.coach_name}</span>
              </span>
              <button
                className={adminBtn.secondary}
                onClick={() => hide(n.id)}
              >
                Hide
              </button>
            </div>
            <p className="text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200">{n.body}</p>
            {(n.tags || []).length > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-300">{n.tags.map((t) => NOTE_TAG_LABELS[t] || t).join(', ')}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
