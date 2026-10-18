'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { riderName } from '../lib/riders'
import {
  fetchCoachingStatus,
  fetchMyCoaching,
  groupRelationships,
  profileCoachingActions,
  inviteAthlete,
  requestCoach,
  endCoaching,
  coachingErrorMessage,
} from '../lib/coaching'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'

// "Invite as athlete" / "Request as my coach" on a rider profile. Incoming requests are
// answered in Settings, where the replacement warning is shown before accepting.
export default function CoachingButtons({ userId, rider }) {
  const [state, setState] = useState({ id: null, status: 'none' })
  const [viewerHasCoach, setViewerHasCoach] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!userId || !rider?.id || rider.id === userId) return
    const [{ id, status }, mine] = await Promise.all([
      fetchCoachingStatus(supabase, rider.id),
      fetchMyCoaching(supabase, userId),
    ])
    setState({ id, status })
    setViewerHasCoach(!!groupRelationships(mine.rows, userId).coach)
  }, [userId, rider?.id])

  useEffect(() => {
    load()
  }, [load])

  if (!userId || !rider || rider.id === userId) return null

  const actions = profileCoachingActions(state.status, { viewerHasCoach })
  const run = async (fn) => {
    setBusy(true)
    setError(null)
    const { error: err } = await fn()
    if (err) setError(coachingErrorMessage(err))
    await load()
    setBusy(false)
  }

  const primary = `${btn} border-orange-500/40 text-orange-500 hover:bg-orange-500/10`
  const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-500`

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder">
      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Coaching</span>
      {actions.label && <span className="text-xs text-slate-600 dark:text-slate-300">{actions.label}</span>}
      {actions.invite && (
        <button type="button" disabled={busy} className={primary} onClick={() => run(() => inviteAthlete(supabase, rider.id))}>
          Invite as athlete
        </button>
      )}
      {actions.request && (
        <button type="button" disabled={busy} className={primary} onClick={() => run(() => requestCoach(supabase, rider.id))}>
          Request as my coach
        </button>
      )}
      {(actions.accept || actions.decline) && (
        <Link href="/settings#coaching" className={primary}>Respond in Settings</Link>
      )}
      {actions.cancel && state.id && (
        <button type="button" disabled={busy} className={quiet} onClick={() => run(() => endCoaching(supabase, state.id))}>
          Cancel
        </button>
      )}
      {actions.end && state.id && (
        <button type="button" disabled={busy} className={quiet} onClick={() => run(() => endCoaching(supabase, state.id))}>
          {state.status === 'coach' ? 'Revoke access' : 'End coaching'}
        </button>
      )}
      {state.status === 'athlete' && (
        <Link href={`/coach/${rider.id}/calendar`} className={primary}>Calendar</Link>
      )}
      {actions.hint && <span className="basis-full text-[11px] text-slate-400">{actions.hint}</span>}
      {state.status === 'none' && (
        <span className="basis-full text-[11px] text-slate-400">
          {riderName(rider)} must accept. A coach can read all of a rider's data (privacy-zone locations stay hidden).
        </span>
      )}
      {error && <span className="basis-full text-[11px] text-rose-500">{error}</span>}
    </div>
  )
}
