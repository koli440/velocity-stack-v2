'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { adminBtn, adminCard } from './admin/AdminUi'
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

  const primary = adminBtn.primary
  const quiet = adminBtn.secondary

  return (
    <div className={`${adminCard} !p-3 flex flex-wrap items-center gap-2`}>
      <span className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">Coaching</span>
      {actions.label && <span className="text-sm text-slate-700 dark:text-slate-200">{actions.label}</span>}
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
      {actions.hint && <span className="basis-full text-sm text-slate-600 dark:text-slate-300">{actions.hint}</span>}
      {state.status === 'none' && (
        <span className="basis-full text-sm text-slate-600 dark:text-slate-300">
          {riderName(rider)} must accept. A coach can read all of a rider's data (privacy-zone locations stay hidden).
        </span>
      )}
      {error && <span className="basis-full text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</span>}
    </div>
  )
}
