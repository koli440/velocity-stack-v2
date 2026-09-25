'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import DurationalCurvesChart from '../../../components/DurationalCurvesChart'
import BenchmarkCards from '../../../components/BenchmarkCards'
import ActivityWizardModal from '../../../components/wizard/ActivityWizardModal'

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
  const [isWizardOpen, setIsWizardOpen] = useState(false)

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

  const formatEffortTime = (sec) => {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return `${m}:${s < 10 ? '0' : ''}${s}`
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

  const detectedEfforts = Array.isArray(activity.detected_efforts) ? activity.detected_efforts : []

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* 1. Horní navigační a akční lišta */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-white transition flex items-center gap-1.5"
          >
            ← Cockpit Telemetry
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
              {activity.title || 'Velodrome Session'}
            </h1>
            {activity.wizard_completed ? (
              <span className="text-[10px] font-bold py-0.5 px-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                {activity.sport_type || 'Track'} • {activity.discipline || 'General'}
              </span>
            ) : (
              <span className="text-[10px] font-black uppercase tracking-wider py-0.5 px-2 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 animate-pulse">
                Nekategorizováno
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-slate-400">{actDate}</p>
        </div>

        {/* Tlačítka vpravo: Spuštění / Úprava Wizardu */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className={`py-2.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition flex items-center gap-2 shadow-sm ${
              !activity.wizard_completed
                ? 'bg-orange-500 hover:bg-orange-600 text-white animate-bounce'
                : 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 border border-orange-500/30'
            }`}
          >
            <span>⚙️</span>
            <span>{activity.wizard_completed ? 'Re-run Wizard' : 'Spustit Wizard'}</span>
          </button>
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

      {/* 3. Benchmarkové karty porovnání výkonu */}
      <BenchmarkCards currentActivity={activity} masterCurves={masterCurves || {}} />

      {/* 4. Durational Curves Chart se zobrazením All-time PB linky */}
      <DurationalCurvesChart curves={curvesMap} masterCurves={masterCurves} />

      {/* 5. Detekované ostré úseky (Efforts) z Wizardu */}
      {detectedEfforts.length > 0 && (
        <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
              <span>⚡</span> Detected Efforts & Sprints ({detectedEfforts.length})
            </h3>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="text-[11px] font-bold text-orange-500 hover:underline"
            >
              Upravit detekci úseků →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {detectedEfforts.map((effort, idx) => (
              <div
                key={effort.id || idx}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 dark:text-white">
                    #{idx + 1} {effort.discipline_label || effort.type || 'Effort'}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                    {effort.duration_sec}s
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 font-mono">
                  Čas: {formatEffortTime(effort.start_sec)} – {formatEffortTime(effort.end_sec)}
                </div>

                <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-200/60 dark:border-slate-800/80 text-center">
                  {effort.max_cadence && (
                    <div>
                      <div className="text-[8px] uppercase font-bold text-slate-400">RPM</div>
                      <div className="text-xs font-black text-orange-500">{effort.max_cadence}</div>
                    </div>
                  )}
                  {effort.peak_torque && (
                    <div>
                      <div className="text-[8px] uppercase font-bold text-slate-400">Torque</div>
                      <div className="text-xs font-black text-amber-400">{effort.peak_torque} Nm</div>
                    </div>
                  )}
                  {(effort.avg_power || effort.max_power) && (
                    <div>
                      <div className="text-[8px] uppercase font-bold text-slate-400">Watty</div>
                      <div className="text-xs font-black text-purple-400">{effort.avg_power || effort.max_power} W</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Spodní panel: Rychlé nastavení dráhy a převodů */}
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

      {/* 7. Integrovaný Wizard Modál pro editaci přímo z detailu */}
      <ActivityWizardModal
        isOpen={isWizardOpen}
        activity={activity}
        tracks={tracks}
        onClose={() => setIsWizardOpen(false)}
        onCompleted={(updatedData) => {
          setActivity((prev) => ({
            ...prev,
            ...updatedData,
            tracks: tracks.find((t) => t.id === updatedData.track_id) || prev.tracks,
          }))
          if (updatedData.chainring) setChainring(String(updatedData.chainring))
          if (updatedData.cog) setCog(String(updatedData.cog))
          if (updatedData.track_id) setTrackId(updatedData.track_id)
        }}
      />
    </div>
  )
}