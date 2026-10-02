'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { deleteActivity } from '../../../lib/activityActions'
import DurationalCurvesChart from '../../../components/DurationalCurvesChart'
import ActivityStreamsChart from '../../../components/ActivityStreamsChart'
import ActivityMetricsGrid from '../../../components/ActivityMetricsGrid'
import TemplateExecutionCard from '../../../components/TemplateExecutionCard'

// Leaflet requires window/document -> dynamic import without SSR
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
  const [baselineCurves, setBaselineCurves] = useState(null)
  const [baselineLoading, setBaselineLoading] = useState(false)

  // Quick edit state for gear ratio and track in the bottom panel
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')
  const [trackId, setTrackId] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!activityId) return

    const loadData = async () => {
      setLoading(true)

      // 1. Parallel fetch of the activity detail, tracks and curves for this activity
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

        // 2. Fetch the rider's historical maxima for comparison (Master Curves)
        if (act.user_id) {
          try {
            const { data: masterData } = await supabase.rpc('get_athlete_master_curves', {
              p_user_id: act.user_id,
            })
            if (masterData) setMasterCurves(masterData)
          } catch (err) {
            console.warn('Master curves RPC was not found or failed:', err)
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

  // Fetch a period-scoped baseline/"history curve" (issue #28): last 30/90 days, this
  // calendar year, the last floating year, or a custom day-picker range. Always reads
  // live from the DB, so it automatically reflects every newly uploaded activity.
  const handleBaselinePeriodChange = async (period, customRange) => {
    if (!activity?.user_id) return
    setBaselineLoading(true)
    try {
      const rpcArgs = { p_user_id: activity.user_id, p_period: period }
      if (period === 'custom' && customRange) {
        rpcArgs.p_start_date = customRange.start
        rpcArgs.p_end_date = customRange.end
      }
      const { data, error } = await supabase.rpc('get_athlete_baseline_curves', rpcArgs)
      if (error) throw error
      setBaselineCurves(data)
    } catch (err) {
      console.warn('Baseline curves RPC failed:', err)
      setBaselineCurves(null)
    } finally {
      setBaselineLoading(false)
    }
  }

  // Quick save of the gear ratio from the bottom bar
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
      alert('Error while saving: ' + error.message)
    }
  }

  // Calculation of gear development (Gear Inches)
  const calcGearInches = () => {
    const ring = parseFloat(chainring)
    const sprocket = parseFloat(cog)
    if (!ring || !sprocket) return 0
    return Math.round((ring / sprocket) * 26.8 * 10) / 10
  }

  // Permanent deletion of the activity (issue #18): deletes the DB record (cascading curves/analysis)
  // and any archived .fit file, then returns the user to the Cockpit.
  const handleDeleteActivity = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to permanently delete this activity? This action is irreversible and will remove all linked data (curves, analysis).'
    )
    if (!confirmed) return

    setDeleting(true)
    const { error } = await deleteActivity(supabase, activity)
    setDeleting(false)

    if (error) {
      alert('Error while deleting activity: ' + error.message)
      return
    }

    router.push('/')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xs uppercase font-bold tracking-wider text-slate-400 animate-pulse">
          Loading activity telemetry and historical maxima...
        </div>
      </div>
    )
  }

  if (!activity) {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Activity not found
        </h2>
        <Link
          href="/"
          className="inline-block py-2 px-4 rounded-xl bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold text-xs uppercase"
        >
          ← Back to Cockpit
        </Link>
      </div>
    )
  }

  const actDate = new Date(activity.activity_date || activity.created_at).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* 1. Top navigation bar */}
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

        <button
          type="button"
          onClick={handleDeleteActivity}
          disabled={deleting}
          className="py-2 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-500 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : '🗑 Delete Activity'}
        </button>
      </div>

      {/* 2. Contextual badges for gear and setup */}
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

      {/* 2b. GPS route map (only for activities with a satellite recording, e.g. road rides) */}
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

      {/* 3. Complete set of activity metrics (incl. comparison with the historical maximum - previously
           a separate BenchmarkCards section, now merged here so the metrics don't appear
           in two similarly looking blocks in a row - issue #20) */}
      <ActivityMetricsGrid activity={activity} curvesMap={curvesMap} masterCurves={masterCurves || {}} />

      {/* 3c. Telemetry chart over time/distance: speed, HR, power, cadence, torque (issue #12) */}
      <ActivityStreamsChart timeSeries={activity.time_series} />

      {/* 4. Durational Curves Chart: current ride vs. a selectable baseline/"history
           curve" (all-time, last 30/90 days, this calendar year, last floating year,
           or a custom day-picker range) - issue #28 */}
      <DurationalCurvesChart
        curves={curvesMap}
        masterCurves={masterCurves}
        baselineCurves={baselineCurves}
        baselineLoading={baselineLoading}
        onPeriodChange={handleBaselinePeriodChange}
      />

      {/* 4b. Template execution card: Phase 2 declarative evaluation + benchmarking */}
      <TemplateExecutionCard activityId={activityId} />

      {/* 5. Bottom panel: Quick track and gearing setup */}
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
              {savingGear ? 'Saving...' : 'Update Setup'}
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
              ✓ Setup saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
