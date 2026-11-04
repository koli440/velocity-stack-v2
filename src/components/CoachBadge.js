'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from './AthleteContext'
import { coachEditAuthorIds, coachEditLabel } from '../lib/coaching'
import { fetchProfilesByIds, authorName } from '../lib/social'
import { coachRunCoachIds, coachRunLabel } from '../lib/coachRuns'

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

// Resolves display names of the coaches behind coach template runs (id -> name).
export function useRunCoachNames(runs) {
  const [names, setNames] = useState({})
  const key = coachRunCoachIds(runs).sort().join(',')
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

// "run by coach <name>" / "run by former coach"; nothing for the rider's own runs.
export function CoachRunBadge({ run, names }) {
  const label = coachRunLabel(run, names)
  if (!label) return null
  return (
    <span
      data-testid="coach-run-badge"
      className="px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-500 text-[9px] font-black uppercase tracking-wider whitespace-nowrap"
    >
      {label}
    </span>
  )
}

// "From template estimate" provenance of a threshold history entry (issue #379), linking to the run's activity.
export function SourceBadge({ row }) {
  const { riderId } = useAthlete()
  if (row?.source !== 'template_estimate') return null
  const href = row.source_activity_id
    ? riderId ? `/coach/${riderId}/activities/${row.source_activity_id}` : `/activities/${row.source_activity_id}`
    : null
  const cls = 'inline-block px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold'
  return href ? <a data-testid="source-badge" href={href} className={cls}>From template estimate</a> : <span data-testid="source-badge" className={cls}>From template estimate</span>
}
