'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import DurationalCurvesChart from '../../../components/DurationalCurvesChart'
import BenchmarkCards from '../../../components/BenchmarkCards'
import TemplateExecutionCard from '../../../components/TemplateExecutionCard'

// Leaflet vyžaduje window/document -> dynamický import bez SSR
const ActivityMap = dynamic(() => import('../../../components/ActivityMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] w-full rounded-2xl bg-slate-100 dark:bg-slate-900/60 animate-pulse" />
  ),
})

export default function ActivityDetailPage() {
  const router = useRouter()
  const params = useParams()
  const activityId = params?.id

  const [loading, setLoading] = useState(true)
  const [savingGear, setSavingGear] = useState(false)
  const [activity, setActivity] = useState(null)
  const [tracks, setTracks] = useState([])
  const [curvesMap, setCurvesMap] = useState({})
  const [masterCurves, setMasterCurves] = useState(null)

  // Rychlý editační stav pro převod a dráhu ve spodním panelu
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')
  const [trackId, setTrackId] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (!activityId) return

    const loadData = async () => {
      setLoading(true)

      // 1. Paralelní načtení detailu jízdy, tratí a křivek této aktivity
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

        // 2. Načtení historických maxim jezdce pro srovnání (Master Curves)
        if (act.user_id) {
          try {
            const { data: masterData } = await supabase.rpc('get_athlete_master_curves', {
              p_user_id: act.user_id,
            })
            if (masterData) setMasterCurves(masterData)
          } catch (err) {
            console.warn('Master curves RPC nebyla nalezena nebo selhala:', err)
          }
        }
      }

      if (tracksRes.data) {
        setTracks(tracksRes.data)
      }

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

  // Rychlé uložení převodu ze spodní lišty
  const handleUpdateGear = async (e) => {
    e.preventDefault()
    setSavingGear(true)
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

    setSavingGear(false)
    if (!error) {
      setSaveSuccess(true)
      setActivity((prev) => ({
        ...prev,
        ...updates,
        tracks: tracks.find((t) => t.id === trackId) || null,
      }))
      setTimeout(() => setSaveSuccess(false), 2500)
    } else {
      alert('Chyba při ukládání: ' + error.message)
    }
  }

  // Výpočet převodového vývinu (Gear Inches)
  const calcGearInches = () => {
    const ring = parseFloat(chainring)
    const sprocket = parseFloat(cog)
    if (!ring || !sprocket) return 0
    return Math.round((ring / sprocket) * 26.8 * 10) / 10
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xs uppercase font-bold tracking-wider text-slate-400 animate-pulse">
          Načítám telemetrii aktivity a historická maxima...
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
      {/* 1. Horní navigační lišta */}
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
      </div>

      {/* 2. Kontextové štítky vybavení a nastavení */}
      {(activity.bike_model || activity.handlebar_setup || activity.helmet || activity.tracks || activity.perceived_exertion) && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
          {activity.tracks && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span>🏟️</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {activity.tracks.name} ({activity.tracks.length_m} m)
              </span>
            </div>
          )}
          {activity.bike_model && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span>🚴</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.bike_model}</span>
            </div>
          )}
          {activity.handlebar_setup && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span>🎯</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.handlebar_setup}</span>
            </div>
          )}
          {activity.helmet && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span>🪖</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.helmet}</span>
            </div>
          )}
          {activity.perceived_exertion && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-500/10 text-orange-500 border border-orange-500/20 font-black">
              <span>🔥</span>
              <span>RPE: {activity.perceived_exertion}/10</span>
            </div>
          )}
        </div>
      )}

      {/* 2b. GPS mapa trasy (pouze pro aktivity se satelitním záznamem, např. silniční jízdy) */}
      {Array.isArray(activity.time_series?.latitude) && activity.time_series.latitude.length > 1 && (
        <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <span>🗺️</span> Route Map
          </h3>
          <ActivityMap
            latitude={activity.time_series.latitude}
            longitude={activity.time_series.longitude}
          />
        </div>
      )}

      {/* 3. Benchmarkové karty porovnání výkonu */}
      <BenchmarkCards currentActivity={activity} masterCurves={masterCurves || {}} />

      {/* 4. Durational Curves Chart se zobrazením All-time PB linky */}
      <DurationalCurvesChart curves={curvesMap} masterCurves={masterCurves} />

      {/* 4b. Template execution card: Phase 2 declarative evaluation + benchmarking */}
      <TemplateExecutionCard activityId={activityId} />

      {/* 5. Spodní panel: Rychlé nastavení dráhy a převodů */}
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
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
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
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-mono font-bold"
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
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-mono font-bold"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savingGear}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
            >
              {savingGear ? 'Ukládám...' : 'Update Setup'}
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
