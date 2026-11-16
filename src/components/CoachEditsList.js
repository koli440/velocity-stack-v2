'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchCoachEdits } from '../lib/coaching'
import { fetchProfilesByIds, authorName } from '../lib/social'
import { describeCoachEdit } from '../lib/coachContext'
import { adminCard } from './admin/AdminUi'

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
    <section data-testid="coach-edits" className={`${adminCard} space-y-3`}>
      <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Coach changes</h2>
      <ul className="divide-y divide-slate-200 dark:divide-slate-600">
        {edits.map((e) => (
          <li key={e.id} className="py-2 text-sm text-slate-700 dark:text-slate-200">
            {describeCoachEdit(e, names[e.coach_id])}
          </li>
        ))}
      </ul>
    </section>
  )
}
