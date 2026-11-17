'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ChatLink from '../../components/ChatLink'
import MessageButton from '../../components/MessageButton'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchMyCoaching, groupRelationships, fetchCoachDashboard, authorName, COACHING_SETTINGS_PATH } from '../../lib/coaching'
import { fetchCoachUnreadComments } from '../../lib/activityComments'
import { fetchCoachFitnessRows, summarizeAthletes, sortAthletes, FITNESS_SORTS } from '../../lib/coachFitness'
import { localDayKey } from '../../lib/fitnessForm'
import { athletePath, formatLastActivity, weeklyVolume } from '../../lib/coachContext'
import Avatar from '../../components/Avatar'
import BotBadge from '../../components/BotBadge'
import PaymentBadge from '../../components/PaymentBadge'
import { fetchPaymentOverview } from '../../lib/coachBilling'
import { subscriptionsByCounterparty } from '../../lib/paymentStatus'
import CoachPlanMeter from '../../components/CoachPlanMeter'
import CoachApplications from '../../components/CoachApplications'
import Icon from '../../components/Icon'
import { AdminPage, EmptyState, ErrorNote, adminBtn, adminCard, adminInput, adminMuted } from '../../components/admin/AdminUi'

const FLAG_STYLES = {
  alert: 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:border-rose-700',
  warn: 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700',
  info: 'bg-slate-100 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600',
}
const signed = (n) => `${n > 0 ? '+' : ''}${n}`

function FitnessSummaryLine({ fitness }) {
  if (!fitness) return null
  if (fitness.empty) {
    return <span data-testid="coach-fitness" className="block text-xs text-slate-600 dark:text-slate-300">Fitness: no training load yet</span>
  }
  return (
    <span data-testid="coach-fitness" className="block space-y-1">
      <span className="block text-xs font-mono text-slate-700 dark:text-slate-200">
        <span title="Fitness (CTL)">Fitness {fitness.fitness}</span> · <span title="Fatigue (ATL)">Fatigue {fitness.fatigue}</span> ·{' '}
        <span title="Form (TSB)">Form {signed(fitness.form)}</span>
        {fitness.ramp !== null && <span title="Fitness change over the last 7 days"> · Ramp {signed(fitness.ramp)}/wk</span>}
      </span>
      {fitness.flags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {fitness.flags.map((f) => (
            <span key={f.key} className={`px-2 py-0.5 rounded-full text-xs font-bold ${FLAG_STYLES[f.level]}`}>{f.label}</span>
          ))}
        </span>
      )}
    </span>
  )
}

// Coach dashboard: every athlete the signed-in user actively coaches (volume figures come from
// the coach_dashboard() RPC, which is gated by is_coach_of) plus pending invites/requests.
export default function CoachDashboardPage() {
  const router = useRouter()
  const [state, setState] = useState({ loading: true, athletes: [], pending: [], error: null })
  const [sortKey, setSortKey] = useState('activity')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const me = session.user.id
      const [{ rows, profiles, error }, dash, { counts: unreadByRider }, fit, { overview }] = await Promise.all([
        fetchMyCoaching(supabase, me),
        fetchCoachDashboard(supabase),
        fetchCoachUnreadComments(supabase),
        // One batched, coach-gated call for all athletes (paged past the 1000-row cap); never the raw activities table.
        fetchCoachFitnessRows(supabase),
        fetchPaymentOverview(supabase),
      ])
      if (cancelled) return
      const groups = groupRelationships(rows, me)
      const paying = subscriptionsByCounterparty(overview.as_coach)
      const byRider = new Map(dash.rows.map((r) => [r.rider_id, r]))
      const fitness = summarizeAthletes(fit.rows, groups.athletes.map((r) => r.rider_id), localDayKey(new Date()))
      const athletes = groups.athletes.map((rel) => ({
        riderId: rel.rider_id,
        paymentSub: paying.get(rel.rider_id) || null,
        profile: profiles.get(rel.rider_id) || null,
        stats: byRider.get(rel.rider_id) || null,
        relationshipId: rel.id,
        unread: unreadByRider.get(rel.rider_id) || 0,
        fitness: fit.error ? null : fitness.get(rel.rider_id),
      }))
      const pending = [
        ...groups.outgoingInvites.map((r) => ({ id: r.id, other: r.rider_id, text: 'Invite sent, waiting for them to accept' })),
        ...groups.incomingRequests.map((r) => ({ id: r.id, other: r.rider_id, text: 'Asked you to be their coach' })),
      ].map((p) => ({ ...p, name: authorName(profiles.get(p.other)) }))
      setState({ loading: false, athletes, pending, error: error || dash.error || fit.error })
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const sorted = useMemo(
    () =>
      sortAthletes(
        state.athletes.map((a) => ({ ...a, name: authorName(a.profile), lastActivityAt: a.stats?.last_activity_at || null })),
        sortKey
      ),
    [state.athletes, sortKey]
  )

  return (
    <AdminPage title="Coach dashboard" description="Your athletes, applications and pending invites." back={null} width="max-w-5xl">
      <div className="space-y-6" data-testid="coach-dashboard">
        <ChatLink />
        <CoachPlanMeter />
        <CoachApplications />
        {state.loading && <p className={`text-sm ${adminMuted}`} role="status">Loading athletes…</p>}
        {state.error && <ErrorNote>{`Could not load everything: ${state.error.message}`}</ErrorNote>}
        {!state.loading && state.athletes.length === 0 && (
          <EmptyState>
            You are not coaching anyone yet.{' '}
            <Link href={COACHING_SETTINGS_PATH} className="font-bold text-orange-700 dark:text-orange-400 underline">Invite an athlete</Link>
          </EmptyState>
        )}
        {state.athletes.length > 1 && (
          <label className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Sort by
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} data-testid="coach-sort" className={`${adminInput} sm:w-64`}>
              {FITNESS_SORTS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        <ul className="grid gap-4 sm:grid-cols-2">
          {sorted.map((a) => {
            const v = weeklyVolume(a.stats)
            const name = authorName(a.profile)
            return (
              <li key={a.riderId} className="flex">
                <div className={`${adminCard} w-full flex flex-col gap-3`}>
                  <Link
                    href={athletePath(a.riderId)}
                    className="block space-y-2 rounded-xl hover:text-orange-700 dark:hover:text-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  >
                    <span className="flex items-center gap-3 font-black text-base text-slate-900 dark:text-white">
                      <Avatar url={a.profile?.avatar_url} name={name} size="w-10 h-10" textSize="text-sm" />
                      <span className="min-w-0 break-words">{name}</span>
                      {a.profile?.is_bot && <BotBadge />}
                      {a.unread > 0 && (
                        <span data-testid="coach-unread-comments" className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-black">
                          {a.unread} new {a.unread === 1 ? 'comment' : 'comments'}
                        </span>
                      )}
                    </span>
                    {a.paymentSub && <span className="block"><PaymentBadge sub={a.paymentSub} /></span>}
                    <span className="block text-sm text-slate-600 dark:text-slate-300">
                      Last activity: {formatLastActivity(a.stats?.last_activity_at)}
                    </span>
                    <span className="block text-xs font-mono text-slate-700 dark:text-slate-200">
                      7 days: {v.sessions} rides · {v.duration} · {v.distance} · load {v.load}{v.gymSessions > 0 ? ` · ${v.gymSessions} gym` : ''}
                    </span>
                    <FitnessSummaryLine fitness={a.fitness} />
                  </Link>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link href={athletePath(a.riderId)} className={adminBtn.primary}>Open athlete <Icon name="chevronRight" /></Link>
                    <MessageButton relationshipId={a.relationshipId} label={`Message ${name}`} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {state.pending.length > 0 && (
          <section className={`${adminCard} space-y-3`} data-testid="coach-pending">
            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Pending</h2>
            <ul className="space-y-2">
              {state.pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-600 p-3 text-sm text-slate-800 dark:text-slate-200">
                  <span><b>{p.name}</b> · {p.text}</span>
                  <Link href={COACHING_SETTINGS_PATH} className={adminBtn.secondary}>Manage</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AdminPage>
  )
}
