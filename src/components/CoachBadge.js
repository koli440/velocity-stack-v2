'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { coachEditAuthorIds, coachEditLabel } from '../lib/coaching'
import { fetchProfilesByIds, authorName } from '../lib/social'

// Resolves the display names of the coaches who stamped `rows` (one query for all rows).
export function useCoachNames(rows) {
  const [names, setNames] = useState({})
  const key = coachEditAuthorIds(rows).sort().join(',')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    fetchProfilesByIds(supabase, key.split(',')).then(({ profiles }) => {
      if (cancelled) return
      const out = {}
      for (const [id, p] of profiles) out[id] = authorName(p)
      setNames(out)
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return names
}

// "Set by coach <name> · date" badge; renders nothing for the rider's own values.
export default function CoachBadge({ row, names }) {
  const label = coachEditLabel(row, names)
  if (!label) return null
  return (
    <span
      data-testid="coach-badge"
      className="inline-block px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold"
    >
      {label}
    </span>
  )
}
