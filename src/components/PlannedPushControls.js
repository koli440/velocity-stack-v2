'use client'
// Push / update / remove a planned workout in the rider's Intervals.icu calendar (detail dialog section).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { fetchPushContext, fetchPushRows, pushToIntervals, removeFromIntervals, fetchWahooPushContext, fetchWahooPushRows, pushToWahoo, removeFromWahoo } from '../lib/plannedPushClient'
import { pushState, PUSH_STATE_LABELS } from '../lib/intervalsWorkout'
import { wahooPushState, WAHOO_PUSH_STATE_LABELS } from '../lib/wahooPlan'
import { plannedStatus } from '../lib/plannedWorkouts'

const PROVIDERS = {
  intervals: {
    name: 'Intervals.icu', short: 'Intervals', fetchContext: fetchPushContext, fetchRows: fetchPushRows, push: pushToIntervals, remove: removeFromIntervals,
    state: pushState, labels: PUSH_STATE_LABELS, remoteId: 'intervals_event_id', removedHint: 'removed in Intervals.icu', skippedNote: 'Skipped workouts are removed from Intervals.icu.',
  },
  wahoo: {
    name: 'Wahoo', short: 'Wahoo', fetchContext: fetchWahooPushContext, fetchRows: fetchWahooPushRows, push: pushToWahoo, remove: removeFromWahoo,
    state: wahooPushState, labels: WAHOO_PUSH_STATE_LABELS, remoteId: 'wahoo_workout_id', removedHint: 'removed in Wahoo', skippedNote: 'Skipped workouts are removed from Wahoo.',
  },
}

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-600 hover:border-emerald-500 disabled:opacity-60'

export default function PlannedPushControls({ workout, onChanged, provider = 'intervals' }) {
  const P = PROVIDERS[provider]
  const [ctx, setCtx] = useState(undefined) // undefined = loading, null = unavailable
  const [row, setRow] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])

  const load = async () => {
    const [c, rows] = await Promise.all([P.fetchContext(supabase, workout.rider_id), P.fetchRows(supabase, [workout.id])])
    setCtx(c)
    setRow(rows.get(workout.id) || null)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout.id, workout.updated_at])

  if (ctx === undefined || ctx === null) return null
  // Wahoo is optional: stay out of the way unless the rider connected it.
  if (provider === 'wahoo' && (!ctx.connected || !['ride', 'track'].includes(workout.discipline || 'ride'))) return null
  const state = P.state(workout, row)
  const status = plannedStatus(workout)
  const skipped = status === 'skipped'
  const completed = status === 'completed'
  const act = async (fn, okMessage) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fn(workout.id)
      setWarnings(res?.warnings || [])
      setMessage(okMessage(res))
    } catch (e) {
      setError(e.message)
    }
    await load()
    setBusy(false)
    onChanged?.()
  }
  const who = ctx.is_self ? 'your' : "the rider's"

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-2" data-testid={`planned-push${provider === 'wahoo' ? '-wahoo' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-slate-900 dark:text-white">{P.name}</div>
        <span data-testid="planned-push-state" data-state={state} className="text-slate-500 dark:text-slate-400">{P.labels[state]}</span>
      </div>
      {!ctx.connected ? (
        <p className="text-slate-500 dark:text-slate-400">
          {ctx.is_self ? (
            <>Connect {P.name} in <Link href="/settings" className="underline text-emerald-600">Settings → Connections</Link> to send planned workouts to your calendar there.</>
          ) : (
            <>The rider has not connected {P.name}, so workouts cannot be sent. They can connect it in Settings → Connections.</>
          )}
        </p>
      ) : (
        <>
          {state === 'error' && row?.last_error && <p className="text-rose-500 font-semibold" role="alert">{row.last_error}</p>}
          {state === 'out_of_date' && <p className="text-amber-600">Changed since it was sent to {P.name}{ctx.auto_enabled ? '; it will be updated automatically soon.' : '.'}</p>}
          {(skipped || completed) && <p className="text-slate-500 dark:text-slate-400">{skipped ? P.skippedNote : 'Completed workouts are not sent.'}</p>}
          <div className="flex flex-wrap gap-2">
            {!skipped && !completed && (
              <button type="button" className={btn} disabled={busy || state === 'pushed'} data-testid="planned-push-button" onClick={() => act(P.push, (r) => (r.recreated ? `Sent again (it was ${P.removedHint}).` : `Sent to ${P.name}.`))}>
                {state === 'not_pushed' ? `Push to ${P.short}` : state === 'pushed' ? 'Up to date' : `Update in ${P.short}`}
              </button>
            )}
            {row?.[P.remoteId] && (
              <button type="button" className={btn} disabled={busy} onClick={() => window.confirm(`Remove this workout from ${who} {P.name} calendar?`) && act(P.remove, () => `Removed from ${P.name}.`)}>
                Remove from {P.short}
              </button>
            )}
          </div>
          {message && <p className="text-emerald-600" role="status">{message}</p>}
          {error && <p className="text-rose-500 font-semibold" role="alert">{error}</p>}
          {[...new Set([...(warnings.length ? warnings : row?.warnings || [])])].map((w) => <p key={w} className="text-amber-600"><Icon name="alert" size="1em" /> {w}</p>)}
          <p className="text-slate-400">
            {ctx.auto_enabled ? 'Automatic sending is on.' : 'Automatic sending is off (Settings → Connections).'} Deleting a pushed workout removes it from {P.name} within ~15 minutes.
          </p>
        </>
      )}
    </div>
  )
}
