'use client'

import { useCallback, useEffect, useState } from 'react'
import { PLANNED_COLUMNS, linkPlannedActivity, unlinkPlannedActivity } from '../lib/plannedWorkouts'

const btn = 'text-[11px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-600 hover:border-orange-500 disabled:opacity-50'

/**
 * "Planned workout" line on the activity page: shows the workout this activity completes, whether it was linked
 * automatically, and lets the rider (or active coach) change or unlink it. RLS decides who sees / edits it, so it
 * renders nothing when there is no link or the viewer has no access.
 */
export default function ActivityPlannedLink({ client, activity }) {
  const [workout, setWorkout] = useState(null)
  const [options, setOptions] = useState(null)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await client.from('planned_workouts').select(PLANNED_COLUMNS).eq('activity_id', activity.id).maybeSingle()
    setWorkout(data || null)
  }, [client, activity.id])

  useEffect(() => {
    load()
  }, [load])

  if (!workout) return null

  const startChange = async () => {
    const { data } = await client
      .from('planned_workouts')
      .select(PLANNED_COLUMNS)
      .eq('rider_id', workout.rider_id)
      .eq('workout_date', workout.workout_date)
      .is('activity_id', null)
      .neq('status', 'skipped')
      .order('created_at', { ascending: true })
    setOptions(data || [])
    setChoice('')
  }

  const run = async (fn) => {
    setBusy(true)
    setError('')
    const err = await fn()
    setBusy(false)
    if (err) return setError(err.message)
    setOptions(null)
    await load()
  }

  const unlink = () => run(async () => (await unlinkPlannedActivity(client, workout.id)).error)
  const change = () =>
    run(async () => {
      const first = await unlinkPlannedActivity(client, workout.id)
      if (first.error) return first.error
      return (await linkPlannedActivity(client, choice, activity.id)).error
    })

  return (
    <div className="text-xs space-y-1" data-testid="activity-planned-link">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500 dark:text-slate-400">
          Planned workout: <span className="font-bold text-slate-700 dark:text-slate-200">{workout.title}</span>
        </span>
        {workout.link_source === 'auto' && <span className="font-semibold text-emerald-600 dark:text-emerald-400">Linked automatically</span>}
        <button type="button" className={btn} disabled={busy} onClick={startChange}>Change</button>
        <button type="button" className={btn} disabled={busy} onClick={unlink}>Unlink</button>
      </div>
      {options && (
        <div className="flex items-center gap-2">
          {options.length === 0 ? (
            <span className="text-slate-500">No other planned workout that day. Unlink to leave this activity unlinked.</span>
          ) : (
            <>
              <select className="rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Planned workout to link">
                <option value="">Choose a workout…</option>
                {options.map((w) => (
                  <option key={w.id} value={w.id}>{w.title}</option>
                ))}
              </select>
              <button type="button" className={btn} disabled={busy || !choice} onClick={change}>Link</button>
            </>
          )}
          <button type="button" className={btn} disabled={busy} onClick={() => setOptions(null)}>Cancel</button>
        </div>
      )}
      {error && <p className="font-bold text-rose-500">{error}</p>}
    </div>
  )
}
