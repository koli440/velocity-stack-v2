'use client'

import { useState } from 'react'
import { saveActivityRace, raceTagOrigin } from '../lib/raceTag'

/**
 * "Race" tag shown at the top of the activity (any ride type). Editable (rider or active coach, saved
 * immediately through the audited RPC) or, with `readOnly`, a plain badge that only renders for races.
 */
export default function RaceTagToggle({ client, activity, onChanged, readOnly = false }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isRace = Boolean(activity.is_race)

  if (readOnly) {
    return isRace ? (
      <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Race</span>
    ) : null
  }

  const toggle = async (e) => {
    const next = e.target.checked
    setSaving(true)
    setError('')
    const { fresh, error: err } = await saveActivityRace(client, activity.id, next)
    setSaving(false)
    if (err) return setError(err.message)
    onChanged?.(fresh)
  }

  return (
    <div>
      <label className={`inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full cursor-pointer ${isRace ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300'}`}>
        <input type="checkbox" checked={isRace} disabled={saving} onChange={toggle} className="accent-emerald-500 w-3.5 h-3.5" />
        Race
      </label>
      {isRace && <p className="mt-1 text-[11px] text-slate-400">{raceTagOrigin(activity)}</p>}
      {error && <p className="mt-1 text-xs font-bold text-rose-500">{error}</p>}
    </div>
  )
}
