'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { atLimit, fetchMyCoachPlan, planNote, usageLabel } from '../lib/coachPlans'
import FoundingBadge from './FoundingBadge'
import { adminCard, adminMuted } from './admin/AdminUi'

// Usage meter: soft information while enforcement is off.
export default function CoachPlanMeter() {
  const [plan, setPlan] = useState(null)
  useEffect(() => { fetchMyCoachPlan(supabase).then((r) => setPlan(r.plan)) }, [])
  if (!plan) return null
  const pct = plan.limit ? Math.min(100, Math.round((plan.active / plan.limit) * 100)) : 0
  return (
    <section className={`${adminCard} space-y-2`} data-testid="coach-plan-meter">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-bold text-slate-900 dark:text-white">{usageLabel(plan)}</p>
        <span className="flex items-center gap-3"><FoundingBadge founding={plan.founding} /><Link href="/coach/plans" className="text-sm font-bold text-orange-700 dark:text-orange-400 underline">Plans</Link></span>
      </div>
      {plan.limit != null && (
        <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={plan.limit} aria-valuenow={Math.min(plan.active, plan.limit)} aria-label="Athletes used">
          <div className={`h-full ${atLimit(plan) ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {planNote(plan) && <p className={`text-xs ${adminMuted}`}>{planNote(plan)}</p>}
    </section>
  )
}
