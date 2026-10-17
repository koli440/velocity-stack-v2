'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchCoachEdits } from '../lib/coaching'
import { fetchProfilesByIds, authorName } from '../lib/social'
import { describeCoachEdit } from '../lib/coachContext'

// Audit trail of coach changes to a rider's physiology/training settings. The rider sees every
// change; a coach sees their own (enforced by RLS on coach_edits).
export default function CoachEditsList({ riderId, limit = 15, emptyHidden = true }) {
  const [edits, setEdits] = useState(null)
  const [names, setNames] = useState({})

  useEffect(() => {
    if (!riderId) return
    let cancelled = false
    ;(async () => {
      const { edits: rows } = await fetchCoachEdits(supabase, riderId, limit)
      const { profiles } = await fetchProfilesByIds(supabase, rows.map((r) => r.coach_id))
      if (cancelled) return
      const out = {}
      for (const [id, p] of profiles) out[id] = authorName(p)
      setNames(out)
      setEdits(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [riderId, limit])

  if (!edits || (emptyHidden && edits.length === 0)) return null
  return (
    <section data-testid="coach-edits" className="space-y-2">
      <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Coach changes</h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {edits.map((e) => (
          <li key={e.id} className="py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            {describeCoachEdit(e, names[e.coach_id])}
          </li>
        ))}
      </ul>
    </section>
  )
}
