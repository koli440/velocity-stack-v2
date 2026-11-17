'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { fetchMyCoachPlan, planNote, tierLimitLabel, tierPriceLabel, usageLabel } from '../../../lib/coachPlans'
import FoundingBadge from '../../../components/FoundingBadge'
import { AdminPage, ErrorNote, adminCard, adminMuted } from '../../../components/admin/AdminUi'

export default function CoachPlansPage() {
  const [state, setState] = useState({ loading: true, plan: null, error: null })
  useEffect(() => { fetchMyCoachPlan(supabase).then((r) => setState({ loading: false, ...r })) }, [])
  const { plan } = state
  return (
    <AdminPage title="Plans" description="How many athletes you can coach. Free during early access." back={{ href: '/coach', label: 'Coach dashboard' }} width="max-w-3xl">
      <div className="space-y-4" data-testid="coach-plans">
        {state.loading && <p className={`text-sm ${adminMuted}`} role="status">Loading…</p>}
        {state.error && <ErrorNote>Plans are not available for your account yet.</ErrorNote>}
        {plan && (
          <>
            <section className={`${adminCard} space-y-1`}>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{usageLabel(plan)} <FoundingBadge founding={plan.founding} /></p>
              <p className={`text-sm ${adminMuted}`}>{planNote(plan)}</p>
              {plan.founding && <p className={`text-sm ${adminMuted}`}>As a founding coach your plan and price are locked for life and you are never downgraded.</p>}
            </section>
            <ul className="grid gap-3 sm:grid-cols-2">
              {plan.tiers.map((t) => (
                <li key={t.tier_key} className={`${adminCard} ${t.tier_key === plan.tier_key ? 'ring-2 ring-orange-500' : ''}`}>
                  <p className="font-black text-slate-900 dark:text-white">{t.name}{t.tier_key === plan.tier_key ? ' · your plan' : ''}</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">{tierLimitLabel(t)}</p>
                  <p className={`text-sm ${adminMuted}`}>{tierPriceLabel(t)} · free during early access</p>
                </li>
              ))}
            </ul>
            <p className={`text-xs ${adminMuted}`}>Only active coaching relationships count. If limits are enforced later, only new athlete acceptances above your limit are blocked; existing athletes, chat and data export always keep working.</p>
          </>
        )}
      </div>
    </AdminPage>
  )
}
