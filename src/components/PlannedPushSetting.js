'use client'
// Settings -> Connections -> Intervals.icu: opt-in for the scheduled push of planned workouts.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setAutoPush, setWahooAutoPush, setGarminAutoPush } from '../lib/plannedPushClient'

export default function PlannedPushSetting({ userId, provider = 'intervals' }) {
  const wahoo = provider === 'wahoo'
  const garmin = provider === 'garmin'
  const name = wahoo ? 'Wahoo' : garmin ? 'Garmin' : 'Intervals.icu'
  const setter = wahoo ? setWahooAutoPush : garmin ? setGarminAutoPush : setAutoPush
  const hint = wahoo
    ? 'Needs the workout permission: reconnect Wahoo if sending fails. Wahoo shows a workout on the device only from 6 days before it is due.'
    : garmin
      ? 'Needs the workout permission: reconnect Garmin and allow sending workouts if it fails. Only workouts with steps are sent.'
      : 'Your API key needs write access.'
  const [row, setRow] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    const { data } = await supabase
      .from('connections')
      .select('push_planned_workouts, planned_push_at, planned_push_error')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()
    setRow(data || null)
  }
  useEffect(() => {
    if (userId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  if (!row) return null
  const toggle = async (enabled) => {
    setBusy(true)
    setError(null)
    const err = await setter(supabase, enabled)
    if (err) setError(err.message)
    await load()
    setBusy(false)
  }

  return (
    <div className="space-y-1" data-testid={provider === 'intervals' ? 'planned-push-setting' : `planned-push-setting-${provider}`}>
      <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={!!row.push_planned_workouts} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <span className="font-bold">Automatically send planned workouts to {name}</span>
          <span className="block text-slate-400">
            Off by default. When on, workouts planned for the next 60 days are sent (and updated) about every 15 minutes. {hint}
          </span>
        </span>
      </label>
      {row.push_planned_workouts && row.planned_push_error && <p className="text-[11px] text-red-500">{row.planned_push_error}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
