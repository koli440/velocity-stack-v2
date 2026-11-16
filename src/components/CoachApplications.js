'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { fetchCoachApplications } from '../lib/coachOnboarding'
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
    <section className="space-y-2" data-testid="coach-applications">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Applications</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/coach/applications/${r.id}`} className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{r.rider_name}{r.main_goal ? <span className="font-normal text-slate-500"> · {r.main_goal}</span> : null}</span>
              {r.health_flag && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">Health flag</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
