'use client'
// Push / update / remove a planned workout in the rider's Intervals.icu calendar (detail dialog section).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { fetchPushContext, fetchPushRows, pushToIntervals, removeFromIntervals } from '../lib/plannedPushClient'
import { pushState, PUSH_STATE_LABELS } from '../lib/intervalsWorkout'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-600 hover:border-emerald-500 disabled:opacity-60'

export default function PlannedPushControls({ workout, onChanged }) {
  const [ctx, setCtx] = useState(undefined) // undefined = loading, null = unavailable
  const [row, setRow] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])

  const load = async () => {
    const [c, rows] = await Promise.all([fetchPushContext(supabase, workout.rider_id), fetchPushRows(supabase, [workout.id])])
    setCtx(c)
    setRow(rows.get(workout.id) || null)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout.id, workout.updated_at])

  if (ctx === undefined || ctx === null) return null
  const state = pushState(workout, row)
  const skipped = workout.status === 'skipped'
  const completed = !!workout.activity_id
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
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-2" data-testid="planned-push">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-slate-900 dark:text-white">Intervals.icu</div>
        <span data-testid="planned-push-state" data-state={state} className="text-slate-500 dark:text-slate-400">{PUSH_STATE_LABELS[state]}</span>
      </div>
      {!ctx.connected ? (
        <p className="text-slate-500 dark:text-slate-400">
          {ctx.is_self ? (
            <>Connect Intervals.icu in <Link href="/settings" className="underline text-emerald-600">Settings → Connections</Link> to send planned workouts to your calendar there.</>
          ) : (
            <>The rider has not connected Intervals.icu, so workouts cannot be sent. They can connect it in Settings → Connections.</>
          )}
        </p>
      ) : (
        <>
          {state === 'error' && row?.last_error && <p className="text-rose-500 font-semibold" role="alert">{row.last_error}</p>}
          {state === 'out_of_date' && <p className="text-amber-600">Changed since it was sent to Intervals.icu{ctx.auto_enabled ? '; it will be updated automatically soon.' : '.'}</p>}
          {(skipped || completed) && <p className="text-slate-500 dark:text-slate-400">{skipped ? 'Skipped workouts are removed from Intervals.icu.' : 'Completed workouts are not sent.'}</p>}
          <div className="flex flex-wrap gap-2">
            {!skipped && !completed && (
              <button type="button" className={btn} disabled={busy || state === 'pushed'} data-testid="planned-push-button" onClick={() => act(pushToIntervals, (r) => (r.recreated ? 'Sent again (it was removed in Intervals.icu).' : 'Sent to Intervals.icu.'))}>
                {state === 'not_pushed' ? 'Push to Intervals' : state === 'pushed' ? 'Up to date' : 'Update in Intervals'}
              </button>
            )}
            {row?.intervals_event_id && (
              <button type="button" className={btn} disabled={busy} onClick={() => window.confirm(`Remove this workout from ${who} Intervals.icu calendar?`) && act(removeFromIntervals, () => 'Removed from Intervals.icu.')}>
                Remove from Intervals
              </button>
            )}
          </div>
          {message && <p className="text-emerald-600" role="status">{message}</p>}
          {error && <p className="text-rose-500 font-semibold" role="alert">{error}</p>}
          {[...new Set([...(warnings.length ? warnings : row?.warnings || [])])].map((w) => <p key={w} className="text-amber-600">⚠ {w}</p>)}
          <p className="text-slate-400">
            {ctx.auto_enabled ? 'Automatic sending is on.' : 'Automatic sending is off (Settings → Connections).'} Deleting a pushed workout removes it from Intervals.icu within ~15 minutes.
          </p>
        </>
      )}
    </div>
  )
}
