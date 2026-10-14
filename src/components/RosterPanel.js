'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { fetchRidersPage, riderName, formatLastActive } from '../lib/riders'
import BotBadge from './BotBadge'
import Avatar from './Avatar'

export default function RosterPanel() {
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
    <aside className="w-full space-y-6">
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
              <Avatar url={r.avatar_url} name={riderName(r)} />
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
    </aside>
  )
}