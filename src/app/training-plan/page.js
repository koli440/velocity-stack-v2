'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchMyMacroPlan } from '../../lib/macroPlannerFlag'
import { WeeklyTargetChart } from '../../components/MacroPlanChart'
import { adminCard, adminMuted } from '../../components/admin/AdminUi'
import { weekStartOf } from '../../lib/macroPlanner'

const KINDS = { build: 'Build', recovery: 'Recovery', taper: 'Taper' }
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const SHAPE_CLASS = {
  H: 'bg-orange-500 border-orange-500 text-white',
  E: 'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100',
  R: 'bg-slate-100 border-slate-300 text-slate-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400',
}
const SHAPE_NAME = { H: 'hard', E: 'easy', R: 'rest' }

// Read-only view of the plan the athlete's coach has published.
export default function TrainingPlanPage() {
  const [plan, setPlan] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    fetchMyMacroPlan(supabase).then((p) => !cancelled && setPlan(p))
    return () => {
      cancelled = true
    }
  }, [])

  if (plan === undefined) return <p className={`${adminMuted} p-4`}>Loading…</p>
  if (!plan) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Training plan</h1>
        <p className={adminMuted}>Your coach has not shared a training plan with you yet.</p>
      </div>
    )
  }
  const weeks = plan.weeks || []
  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10))
  const days = Math.ceil((new Date(`${plan.race_date}T00:00:00Z`) - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000)
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Training plan</h1>
        <p className={adminMuted}>Shared by {plan.coach_name || 'your coach'}. Read-only: ask your coach for changes.</p>
      </div>
      <section className={`${adminCard} p-4`}>
        <h2 className="font-semibold">{plan.race_name || 'A race'}</h2>
        <p className={adminMuted}>{plan.race_date}{days >= 0 ? ` · ${days} day${days === 1 ? '' : 's'} to go` : ''}</p>
      </section>
      <section className={`${adminCard} p-4`}>
        <h2 className="font-semibold mb-2">Weekly training load targets</h2>
        <WeeklyTargetChart weeks={weeks} label="Planned weekly training load" />
      </section>
      <section className={`${adminCard} p-4`}>
        <h2 className="font-semibold mb-2">Weeks</h2>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {weeks.map((w) => (
            <li key={w.week_start} className={`py-2 ${w.week_start === thisWeek ? 'font-medium' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="tabular-nums">{w.week_start}</span>
                <span>{KINDS[w.kind] || w.kind}</span>
                <span className="tabular-nums">TL {w.target_tl}</span>
                {w.focus ? <span className={adminMuted}>{w.focus}</span> : null}
                {w.day_shape ? (
                  <span className="flex gap-0.5 ml-auto" role="img" aria-label={`Day shape: ${w.day_shape.split('').map((c, i) => `${DAY_LETTERS[i]} ${SHAPE_NAME[c]}`).join(', ')}`}>
                    {w.day_shape.split('').map((c, i) => (
                      <span key={i} className={`w-5 h-5 text-[10px] leading-5 text-center rounded border ${SHAPE_CLASS[c]}`}>{DAY_LETTERS[i]}</span>
                    ))}
                  </span>
                ) : null}
              </div>
              {w.note ? <p className={`${adminMuted} text-sm`}>{w.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
