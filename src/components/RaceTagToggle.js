'use client'

import { useState } from 'react'
import { setActivityRace, raceTagOrigin } from '../lib/raceTag'

/** Checkbox for the "race" activity tag; saves immediately through the audited RPC (rider or coach). */
export default function RaceTagToggle({ client, activity, onChanged }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = async (e) => {
    const next = e.target.checked
    setSaving(true)
    setError('')
    const { isRace, error: err } = await setActivityRace(client, activity.id, next)
    if (err) {
      setSaving(false)
      setError(err.message)
      return
    }
    const { data: fresh } = await client
      .from('shared_activities')
      .select('is_race, race_tag_auto, race_set_by, race_set_at, race_set_by_coach')
      .eq('id', activity.id)
      .maybeSingle()
    setSaving(false)
    onChanged?.(fresh || { is_race: isRace, race_tag_auto: false })
  }

  return (
    <div className="mb-4">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <input type="checkbox" checked={Boolean(activity.is_race)} disabled={saving} onChange={toggle} className="accent-emerald-500 w-4 h-4" />
        Race
      </label>
      {activity.is_race && <p className="mt-1 text-[11px] text-slate-400">{raceTagOrigin(activity)}</p>}
      {error && <p className="mt-1 text-xs font-bold text-rose-500">{error}</p>}
    </div>
  )
}
