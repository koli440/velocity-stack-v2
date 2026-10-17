'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchMyCoaching, groupRelationships, fetchCoachDashboard, authorName, COACHING_SETTINGS_PATH } from '../../lib/coaching'
import { athletePath, formatLastActivity, weeklyVolume } from '../../lib/coachContext'
import Avatar from '../../components/Avatar'

// Coach dashboard: every athlete the signed-in user actively coaches (volume figures come from
// the coach_dashboard() RPC, which is gated by is_coach_of) plus pending invites/requests.
export default function CoachDashboardPage() {
  const router = useRouter()
  const [state, setState] = useState({ loading: true, athletes: [], pending: [], error: null })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const me = session.user.id
      const [{ rows, profiles, error }, dash] = await Promise.all([
        fetchMyCoaching(supabase, me),
        fetchCoachDashboard(supabase),
      ])
      if (cancelled) return
      const groups = groupRelationships(rows, me)
      const byRider = new Map(dash.rows.map((r) => [r.rider_id, r]))
      const athletes = groups.athletes.map((rel) => ({
        riderId: rel.rider_id,
        profile: profiles.get(rel.rider_id) || null,
        stats: byRider.get(rel.rider_id) || null,
      }))
      const pending = [
        ...groups.outgoingInvites.map((r) => ({ id: r.id, other: r.rider_id, text: 'Invite sent, waiting for them to accept' })),
        ...groups.incomingRequests.map((r) => ({ id: r.id, other: r.rider_id, text: 'Asked you to be their coach' })),
      ].map((p) => ({ ...p, name: authorName(profiles.get(p.other)) }))
      setState({ loading: false, athletes, pending, error: error || dash.error })
    })()
    return () => {
      cancelled = true
    }
  }, [router])

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
      <ul className="grid gap-3 sm:grid-cols-2">
        {state.athletes.map((a) => {
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
                </span>
                <span className="block text-[11px] text-slate-500">
                  Last activity: {formatLastActivity(a.stats?.last_activity_at)}
                </span>
                <span className="block text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  7 days: {v.sessions} sessions · {v.duration} · {v.distance} · load {v.load}
                </span>
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
