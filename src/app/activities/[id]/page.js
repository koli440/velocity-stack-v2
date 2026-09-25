'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import DurationalCurvesChart from '../../../components/DurationalCurvesChart'

export default function ActivityDetailPage() {
  const router = useRouter()
  const params = useParams()
  const activityId = params?.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activity, setActivity] = useState(null)
  const [tracks, setTracks] = useState([])
  const [curvesMap, setCurvesMap] = useState({})

  // Editační stav pro převod a trať
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')
  const [trackId, setTrackId] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (!activityId) return

    const loadData = async () => {
      setLoading(true)

      // 1. Načtení detailu aktivity a tratí
      const [actRes, tracksRes, curvesRes] = await Promise.all([
        supabase
          .from('activities')
          .select('*, tracks(*)')
          .eq('id', activityId)
          .maybeSingle(),
        supabase.from('tracks').select('*').order('name'),
        supabase
          .from('activity_curves')
          .select('curve_type, data')
          .eq('activity_id', activityId),
      ])

      if (actRes.data) {
        const act = actRes.data
        setActivity(act)
        setChainring(act.chainring ? String(act.chainring) : '58')
        setCog(act.cog ? String(act.cog) : '14')
        setTrackId(act.track_id || '')
      }

      if (tracksRes.data) {
        setTracks(tracksRes.data)
      }

      // 2. Převod pole křivek ze Supabase na objekt: { Cadence: {...}, Speed: {...}, ... }
      if (curvesRes.data) {
        const mapped = {}
        curvesRes.data.forEach((row) => {
          if (row.curve_type && row.data) {
            mapped[row.curve_type] = row.data
          }
        })
        setCurvesMap(mapped)
      }

      setLoading(false)
    }

    loadData()
  }, [activityId])

  // Uložení upraveného převodu a tratě
  const handleUpdateGear = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)

    const updates = {
      chainring: parseInt(chainring) || null,
      cog: parseInt(cog) || null,
      track_id: trackId || null,
    }

    const { error } = await supabase
      .from('activities')
      .update(updates)
      .eq('id', activityId)

    setSaving(false)
    if (!error) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } else {
      alert('Chyba při ukládání: ' + error.message)
    }
  }

  // Výpočet převodového poměru a vývinu (Gear Inches)
  const calcGearInches = () => {
    const ring = parseFloat(chainring)
    const sprocket = parseFloat(cog)
    if (!ring || !sprocket) return 0
    return Math.round((ring / sprocket) * 27 * 10) / 10
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xs uppercase font-bold tracking-wider text-slate-400 animate-pulse">
          Načítám telemetrii aktivity...
        </div>
      </div>
    )
  }

  if (!activity) {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Aktivita nebyla nalezena
        </h2>
        <Link
          href="/"
          className="inline-block py-2 px-4 rounded-xl bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold text-xs uppercase"
        >
          ← Zpět do Cockpitu
        </Link>
      </div>
    )
  }

  const actDate = new Date(activity.activity_date || activity.created_at).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Horní navigační pruh */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-white transition flex items-center gap-1.5"
          >
            ← Cockpit Telemetry
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
            {activity.title || 'Velodrome Session'}
          </h1>
          <p className="text-xs font-semibold text-slate-400">{actDate}</p>
        </div>

        {/* Zvolený Velodrom */}
        {activity.tracks && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span className="text-sm">🏟️</span>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Velodrome</div>
              <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                {activity.tracks.name} ({activity.tracks.length_m} m)
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Telemetrické karty */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Peak Cadence</div>
          <div className="text-2xl font-black text-orange-500 mt-1">
            {activity.max_cadence_rpm != null ? `${activity.max_cadence_rpm} RPM` : '—'}
          </div>
        </div>

        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Max Speed</div>
          <div className="text-2xl font-black text-sky-400 mt-1">
            {activity.max_speed_kmh != null ? `${activity.max_speed_kmh} km/h` : '—'}
          </div>
        </div>

        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Max Power</div>
          <div className="text-2xl font-black text-purple-400 mt-1">
            {activity.max_power_w != null ? `${activity.max_power_w} W` : '—'}
          </div>
        </div>

        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Peak Torque</div>
          <div className="text-2xl font-black text-amber-400 mt-1">
            {activity.peak_torque_nm != null ? `${activity.peak_torque_nm} Nm` : '—'}
          </div>
        </div>
      </div>

      {/* Komponenta s Durational Curves */}
      <DurationalCurvesChart curves={curvesMap} />

      {/* Spodní panel: Nastavení dráhy a převodů */}
      <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <span>⚙️</span> Track & Gearing Setup for this Ride
        </h3>

        <form onSubmit={handleUpdateGear} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Velodrome
            </label>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- No Track Selected --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.length_m} m)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Chainring
            </label>
            <input
              type="number"
              value={chainring}
              onChange={(e) => setChainring(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Cog
            </label>
            <input
              type="number"
              value={cog}
              onChange={(e) => setCog(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
            >
              {saving ? 'Ukládám...' : 'Update Setup'}
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs">
          <div className="text-slate-400">
            Calculated Gear:{' '}
            <span className="font-extrabold text-slate-800 dark:text-slate-200">
              {calcGearInches()}"
            </span>{' '}
            ({chainring} × {cog})
          </div>

          {saveSuccess && (
            <span className="font-bold text-emerald-500 animate-fade-in">
              ✓ Nastavení uloženo
            </span>
          )}
        </div>
      </div>
    </div>
  )
}