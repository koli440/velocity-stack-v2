'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchMyCoaching, groupRelationships, fetchCoachDashboard, authorName, COACHING_SETTINGS_PATH } from '../../lib/coaching'
import { fetchCoachUnreadComments } from '../../lib/activityComments'
import { fetchCoachFitnessRows, summarizeAthletes, sortAthletes, FITNESS_SORTS } from '../../lib/coachFitness'
import { localDayKey } from '../../lib/fitnessForm'
import { athletePath, formatLastActivity, weeklyVolume } from '../../lib/coachContext'
import Avatar from '../../components/Avatar'
import BotBadge from '../../components/BotBadge'

const FLAG_STYLES = {
  alert: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  info: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
}
const signed = (n) => `${n > 0 ? '+' : ''}${n}`

function FitnessSummaryLine({ fitness }) {
  if (!fitness) return null
  if (fitness.empty) {
    return <span data-testid="coach-fitness" className="block text-[11px] text-slate-400">Fitness: no training load yet</span>
  }
  return (
    <span data-testid="coach-fitness" className="block space-y-1">
      <span className="block text-[11px] font-mono text-slate-600 dark:text-slate-300">
        <span title="Fitness (CTL)">Fitness {fitness.fitness}</span> · <span title="Fatigue (ATL)">Fatigue {fitness.fatigue}</span> ·{' '}
        <span title="Form (TSB)">Form {signed(fitness.form)}</span>
        {fitness.ramp !== null && <span title="Fitness change over the last 7 days"> · Ramp {signed(fitness.ramp)}/wk</span>}
      </span>
      {fitness.flags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {fitness.flags.map((f) => (
            <span key={f.key} className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${FLAG_STYLES[f.level]}`}>{f.label}</span>
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
      const [{ rows, profiles, error }, dash, { counts: unreadByRider }, fit] = await Promise.all([
        fetchMyCoaching(supabase, me),
        fetchCoachDashboard(supabase),
        fetchCoachUnreadComments(supabase),
        // One batched, coach-gated call for all athletes (paged past the 1000-row cap); never the raw activities table.
        fetchCoachFitnessRows(supabase),
      ])
      if (cancelled) return
      const groups = groupRelationships(rows, me)
      const byRider = new Map(dash.rows.map((r) => [r.rider_id, r]))
      const fitness = summarizeAthletes(fit.rows, groups.athletes.map((r) => r.rider_id), localDayKey(new Date()))
      const athletes = groups.athletes.map((rel) => ({
        riderId: rel.rider_id,
        profile: profiles.get(rel.rider_id) || null,
        stats: byRider.get(rel.rider_id) || null,
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
    <div className="space-y-6" data-testid="coach-dashboard">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Coach dashboard</h1>
      {state.loading && <p className="text-xs text-slate-400">Loading…</p>}
      {state.error && <p className="text-xs text-red-500">Could not load everything: {state.error.message}</p>}
      {!state.loading && state.athletes.length === 0 && (
        <p className="text-sm text-slate-500">
          You are not coaching anyone yet.{' '}
          <Link href={COACHING_SETTINGS_PATH} className="underline">Invite an athlete</Link>
        </p>
      )}
      {state.athletes.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Sort by
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            data-testid="coach-sort"
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200"
          >
            {FITNESS_SORTS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {sorted.map((a) => {
          const v = weeklyVolume(a.stats)
          const name = authorName(a.profile)
          return (
            <li key={a.riderId}>
              <Link
                href={athletePath(a.riderId)}
                className="block p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder hover:border-indigo-500 transition space-y-2"
              >
                <span className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                  <Avatar url={a.profile?.avatar_url} name={name} size="w-7 h-7" textSize="text-xs" /> {name}
                  {a.profile?.is_bot && <BotBadge />}
                  {a.unread > 0 && (
                    <span
                      data-testid="coach-unread-comments"
                      className="ml-auto px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-black"
                    >
                      {a.unread} new {a.unread === 1 ? 'comment' : 'comments'}
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-slate-500">
                  Last activity: {formatLastActivity(a.stats?.last_activity_at)}
                </span>
                <span className="block text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  7 days: {v.sessions} sessions · {v.duration} · {v.distance} · load {v.load}
                </span>
                <FitnessSummaryLine fitness={a.fitness} />
              </Link>
            </li>
          )
        })}
      </ul>
      {state.pending.length > 0 && (
        <section className="space-y-2" data-testid="coach-pending">
          <h2 className="text-xs uppercase font-bold tracking-wider text-slate-400">Pending</h2>
          <ul className="space-y-1">
            {state.pending.map((p) => (
              <li key={p.id} className="text-xs text-slate-600 dark:text-slate-300">
                <b>{p.name}</b> · {p.text} ·{' '}
                <Link href={COACHING_SETTINGS_PATH} className="underline">Manage</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
