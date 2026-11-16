'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { fetchCoachApplications } from '../lib/coachOnboarding'
import { adminCard } from './admin/AdminUi'
import { useCoachModule } from './useCoachModule'

// Pending onboarding applications on the coach dashboard (module flag only).
export default function CoachApplications() {
  const enabled = useCoachModule()
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!enabled) return
    fetchCoachApplications(supabase).then(({ rows: r }) => setRows(r))
  }, [enabled])
  if (!enabled || rows.length === 0) return null
  return (
    <section className={`${adminCard} space-y-3`} data-testid="coach-applications">
      <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Applications</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/coach/applications/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-600 hover:border-orange-500">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{r.rider_name}{r.main_goal ? <span className="font-normal text-slate-600 dark:text-slate-300"> · {r.main_goal}</span> : null}</span>
              {r.health_flag && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700">Health flag</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
