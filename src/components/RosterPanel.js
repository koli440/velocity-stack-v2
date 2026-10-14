'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { fetchRidersPage, riderName, riderInitial, formatLastActive } from '../lib/riders'
import BotBadge from './BotBadge'

export default function RosterPanel({ onAddWorkout }) {
  const [riders, setRiders] = useState([])

  useEffect(() => {
    let cancelled = false
    fetchRidersPage(supabase, { limit: 5 }).then(({ riders: page }) => {
      if (!cancelled) setRiders(page)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="w-80 shrink-0 space-y-6">
      {/* Button to open the modal */}
      <button
        onClick={onAddWorkout}
        className="w-full py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-extrabold text-sm uppercase tracking-wider shadow-lg transition transform active:scale-95"
      >
        + Add Workout / Session
      </button>

      {/* Recently active riders (real data, see search_riders) */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Active Riders</h3>
          <Link href="/riders" className="text-xs font-bold text-orange-500 hover:text-orange-600">
            View all
          </Link>
        </div>

        <div className="space-y-3">
          {riders.map((r) => (
            <Link key={r.id} href={`/riders/${r.id}`} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">
                {riderInitial(r)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white leading-tight">
                  <span className="truncate">{riderName(r)}</span>
                  {r.is_bot && <BotBadge />}
                </div>
                <div className="text-[11px] text-slate-400">{formatLastActive(r.last_activity_date)}</div>
              </div>
            </Link>
          ))}
          {riders.length === 0 && <p className="text-[11px] text-slate-400">No riders to show yet.</p>}
        </div>
      </div>

      {/* Quick Stats & Hydration */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm">Quick Stats & Hydration</h3>
        
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-lg">💧</span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">Hydration</div>
            <div className="text-[11px] text-emerald-500 font-semibold">Optimal</div>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-lg">⚡</span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">Fatigue</div>
            <div className="text-[11px] text-slate-400">Low (12%)</div>
          </div>
        </div>
      </div>
    </aside>
  )
}