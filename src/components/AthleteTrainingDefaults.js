'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTracks } from '../lib/lookups'
import { fetchAthleteProfile, updateAthleteProfile } from '../lib/coaching'
import VelodromePicker from './VelodromePicker'
import CoachBadge, { useCoachNames } from './CoachBadge'

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
      default_chainring: p?.default_chainring ?? '',
      default_cog: p?.default_cog ?? '',
      crank_length_mm: p?.crank_length_mm ?? '',
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
    setBusy(true)
    setStatus(null)
    const { error } = await updateAthleteProfile(supabase, riderId, {
      home_track_id: form.home_track_id || null,
      default_chainring: num(form.default_chainring),
      default_cog: num(form.default_cog),
      crank_length_mm: num(form.crank_length_mm),
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
      <div className="grid grid-cols-3 gap-2">
        {[
          ['default_chainring', 'Chainring', '1'],
          ['default_cog', 'Cog', '1'],
          ['crank_length_mm', 'Crank (mm)', '0.5'],
        ].map(([key, label, step]) => (
          <div key={key}>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{label}</label>
            <input
              type="number"
              step={step}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className={input}
            />
          </div>
        ))}
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
