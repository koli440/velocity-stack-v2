'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import { weekBounds, weekTotals, formatDuration, formatKm, formatTss } from '../lib/weekStats'

const COLUMNS =
  'activity_date, distance_m, moving_time_s, elapsed_time_s, duration_sec, training_load'

function delta(cur, prev, fmt) {
  if (cur === null || prev === null || prev === 0) return null
  const diff = cur - prev
  if (diff === 0) return 'same as last week'
  return `${diff > 0 ? '+' : '-'}${fmt(Math.abs(diff))} vs last week`
}

// "This week" (Mon-Sun, local time) distance / time / TSS for the rider's own activities.
export default function WeekStatsCard({ userId }) {
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    const { prevStart, end } = weekBounds(new Date())
    const { data, error } = await supabase
      .from('activities')
      .select(COLUMNS)
      .eq('user_id', userId)
      .gte('activity_date', prevStart.toISOString())
      .lt('activity_date', end.toISOString())
    if (!error) setTotals(weekTotals(data || [], new Date()))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, load)
    return () => window.removeEventListener(ACTIVITIES_CHANGED_EVENT, load)
  }, [load])

  const cur = totals?.current
  const prev = totals?.previous
  const stats = cur && [
    ['Distance', formatKm(cur.distanceM), delta(cur.distanceM, prev.distanceM, formatKm)],
    ['Time', formatDuration(cur.timeS), delta(cur.timeS, prev.timeS, formatDuration)],
    ['TSS', formatTss(cur.tss), delta(cur.tss, prev.tss, (v) => String(Math.round(v)))],
  ]

  return (
    <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-3 xl:p-4 space-y-2 xl:space-y-3">
      <h2 className="text-xs font-black uppercase tracking-wide text-slate-900 dark:text-white">
        This week
      </h2>
      {loading ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading…</p>
      ) : !cur ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Could not load this week.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            {stats.map(([label, value, change]) => (
              <div key={label}>
                <dt className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  {label}
                </dt>
                <dd className="text-sm font-black text-slate-900 dark:text-white">{value}</dd>
                {change && (
                  <p className="text-[9px] text-slate-500 dark:text-slate-400">{change}</p>
                )}
              </div>
            ))}
          </dl>
          {cur.count === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">No rides yet this week.</p>
          )}
        </>
      )}
    </section>
  )
}
