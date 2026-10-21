'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTracks } from '../lib/lookups'
import { fetchAthleteProfile, updateAthleteProfile } from '../lib/coaching'
import VelodromePicker from './VelodromePicker'
import GearPicker from './GearPicker'
import { parseGear, toGearField } from '../lib/gear'
import CoachBadge, { useCoachNames } from './CoachBadge'
import { RIDE_TYPES, effectiveRideType } from '../lib/rideType'

const input =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono'

// Training defaults of an athlete, edited by their coach through coach_update_athlete_profile
// (the only way a coach can write profile columns; whitelisted in the database).
export default function AthleteTrainingDefaults({ riderId, athlete }) {
  const [profile, setProfile] = useState(athlete)
  const [tracks, setTracks] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const names = useCoachNames(profile ? [profile] : [])

  const hydrate = (p) =>
    setForm({
      home_track_id: p?.home_track_id || '',
      default_chainring: toGearField(p?.default_chainring),
      default_cog: toGearField(p?.default_cog),
      crank_length_mm: p?.crank_length_mm ?? '',
      default_ride_type: effectiveRideType(p?.default_ride_type),
    })

  useEffect(() => {
    setProfile(athlete)
    hydrate(athlete)
  }, [athlete])

  useEffect(() => {
    fetchTracks(supabase).then(({ data }) => setTracks(data || []))
  }, [])

  const num = (v) => (v === '' || v == null ? null : Number(v))

  const save = async () => {
    const gear = parseGear(form.default_chainring, form.default_cog)
    if (!gear.valid) return setStatus({ error: gear.error })
    setBusy(true)
    setStatus(null)
    const { error } = await updateAthleteProfile(supabase, riderId, {
      home_track_id: form.home_track_id || null,
      default_chainring: gear.chainring,
      default_cog: gear.cog,
      crank_length_mm: num(form.crank_length_mm),
      default_ride_type: form.default_ride_type,
    })
    if (error) {
      setBusy(false)
      return setStatus({ error: error.message })
    }
    const { athlete: fresh } = await fetchAthleteProfile(supabase, riderId)
    setBusy(false)
    if (fresh) {
      setProfile(fresh)
      hydrate(fresh)
    }
    setStatus({ ok: 'Saved' })
  }

  if (!form) return null
  return (
    <div className="space-y-2 p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        Gear defaults <CoachBadge row={profile} names={names} />
      </p>
      <VelodromePicker
        tracks={tracks}
        value={form.home_track_id}
        onChange={(v) => setForm({ ...form, home_track_id: v })}
        favoriteId={null}
        emptyLabel="-- No Home Track --"
        compact
      />
      <div>
        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1" htmlFor="athlete-default-ride-type">Default ride type</label>
        <select
          id="athlete-default-ride-type"
          value={form.default_ride_type}
          onChange={(e) => setForm({ ...form, default_ride_type: e.target.value })}
          className={input}
        >
          {RIDE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <GearPicker
          label="Default gear (optional)"
          chainring={form.default_chainring}
          cog={form.default_cog}
          onChange={(g) => setForm({ ...form, default_chainring: g.chainring, default_cog: g.cog })}
          showStats
          className="col-span-2"
        />
        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Crank (mm)</label>
          <input
            type="number"
            step="0.5"
            value={form.crank_length_mm}
            onChange={(e) => setForm({ ...form, crank_length_mm: e.target.value })}
            className={input}
          />
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold disabled:opacity-50"
      >
        Save defaults
      </button>
      {status?.error && <p className="text-[11px] text-red-500">{status.error}</p>}
      {status?.ok && <p className="text-[11px] text-emerald-600">{status.ok}</p>}
    </div>
  )
}
