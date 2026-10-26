'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Portal from '../../../components/Portal'
import { fullDateTime } from '../../../lib/dateFormat'
import { fetchProfilesByIds, authorName } from '../../../lib/social'
import Avatar from '../../../components/Avatar'
import BotBadge from '../../../components/BotBadge'
import CalendarTile from '../../../components/CalendarTile'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { parseCoachPath, activityBackHref } from '../../../lib/coachContext'
import { resolveBack } from '../../../lib/returnTo'
import { supabase } from '../../../lib/supabase'
import { deleteActivity } from '../../../lib/activityActions'
import { syncFeedData } from '../../../lib/feedSync'
import { removeActivityPhotoFiles } from '../../../lib/activityPhotos'
import DurationalCurvesChart from '../../../components/DurationalCurvesChart'
import ActivityStreamsChart from '../../../components/ActivityStreamsChart'
import ActivityMetricsGrid from '../../../components/ActivityMetricsGrid'
import TemplateRunsSection from '../../../components/TemplateRunsSection'
import VelodromePicker from '../../../components/VelodromePicker'
import { fetchTracks } from '../../../lib/lookups'
import EditActivityModal from '../../../components/EditActivityModal'
import { weightFromActivity } from '../../../lib/weightHistory'

// Leaflet requires window/document -> dynamic import without SSR
import ActivityPhotoGallery from '../../../components/ActivityPhotoGallery'
import Icon from '../../../components/Icon'
import RideGearEditor from '../../../components/RideGearEditor'
import RaceTagToggle from '../../../components/RaceTagToggle'
import ActivityPlannedLink from '../../../components/ActivityPlannedLink'
import CoachBadge, { useCoachNames } from '../../../components/CoachBadge'
import { gearLabel } from '../../../lib/gear'
import { effectiveRideType, rideTypeHasGear, rideTypeLabel } from '../../../lib/rideType'
import { gearsToForm, resolveGears, resolveSegments, withSegmentSpeed } from '../../../lib/gearSegments'
import { buildActivityUpdates } from '../../../lib/activityEdit'
import { updateActivityGear } from '../../../lib/coaching'
import { computeDurationalCurve } from '../../../lib/streamAnalysis'
import ActivityComments from '../../../components/ActivityComments'
import GymSessionSection from '../../../components/GymSessionSection'

const ActivityMap = dynamic(() => import('../../../components/ActivityMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] w-full rounded-2xl bg-slate-100 dark:bg-slate-900/60 animate-pulse" />
  ),
})

// useSearchParams needs a Suspense boundary for static rendering.
export default function ActivityDetailPage() {
  return (
    <Suspense fallback={null}>
      <ActivityDetail />
    </Suspense>
  )
}

function ActivityDetail() {
  const router = useRouter()
  const params = useParams()
  const coachRiderId = parseCoachPath(usePathname()).riderId
  const search = useSearchParams().toString()
  const inAthleteContext = Boolean(coachRiderId)
  const back = resolveBack({
    search,
    riderId: coachRiderId,
    fallbackHref: activityBackHref(coachRiderId),
    fallbackLabel: inAthleteContext ? '← Activities' : '← Cockpit Telemetry',
  })
  const backHref = back.href
  const backLabel = back.fromOrigin ? `← ${back.label}` : back.label
  const activityId = params?.id

  const [loading, setLoading] = useState(true)
  const [savingGear, setSavingGear] = useState(false)
  const [activity, setActivity] = useState(null)
  const [tracks, setTracks] = useState([])
  const [curvesMap, setCurvesMap] = useState({})
  const [masterCurves, setMasterCurves] = useState(null)
  const [baselineCurves, setBaselineCurves] = useState(null)
  const [baselineLoading, setBaselineLoading] = useState(false)
  // Matched windows of every template run toggled "on chart" (issues #14, #66),
  // overlaid on the stream charts via ActivityStreamsChart's highlightWindows prop.
  const [highlightWindows, setHighlightWindows] = useState([])

  // Quick edit state for gear ratio and track in the bottom panel
  const [rideType, setRideType] = useState('road')
  const [gears, setGears] = useState([])
  const [segments, setSegments] = useState([])
  const [trackId, setTrackId] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // true when another rider's activity is opened through the restricted shared_activities view
  const [sharedView, setSharedView] = useState(false)
  const [rider, setRider] = useState(null)

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
        fetchTracks(supabase),
        supabase
          .from('activity_curves')
          .select('curve_type, data')
          .eq('activity_id', activityId),
      ])

      let actData = actRes.data
      if (!actData) {
        // Not our activity: other riders only get the restricted view (no GPS, no raw file).
        const shared = await supabase.from('shared_activities').select('*').eq('id', activityId).maybeSingle()
        actData = shared.data
        setSharedView(!!actData)
      }

      if (actData) {
        const act = actData
        setActivity(act)
        if (act.user_id) {
          fetchProfilesByIds(supabase, [act.user_id]).then(({ profiles }) => setRider(profiles.get(act.user_id) || null))
        }
        setRideType(effectiveRideType(act.ride_type))
        setGears(gearsToForm(act))
        setSegments(resolveSegments(act))
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

          // 2b. Default baseline/"history curve" (issue #28): All-time, via the
          // period-scoped RPC so it has the same per-point activity attribution/link
          // as every other baseline period (the legacy master-curves RPC above does not).
          await fetchBaselineCurves(act.user_id, 'all_time')
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
        // Fall back to the curves snapshot stored on the activity when no activity_curves rows exist.
        setCurvesMap(Object.keys(mapped).length ? mapped : actData?.curves_data || {})
      }

      setLoading(false)
    }

    loadData()
  }, [activityId])

  // Fetch a period-scoped baseline/"history curve" (issue #28): all-time, last 30/90
  // days, this calendar year, the last floating year, or a custom day-picker range.
  // Always reads live from the DB, so it automatically reflects every newly uploaded
  // activity without any separate recompute step.
  const fetchBaselineCurves = async (userId, period, customRange) => {
    setBaselineLoading(true)
    try {
      const rpcArgs = { p_user_id: userId, p_period: period }
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

  // Wired to DurationalCurvesChart's period selector (issue #28).
  const handleBaselinePeriodChange = (period, customRange) => {
    if (!activity?.user_id) return
    fetchBaselineCurves(activity.user_id, period, customRange)
  }

  // Quick save of velodrome, ride type, gears and segments from the bottom panel (own activity).
  const handleUpdateGear = async (e) => {
    e.preventDefault()
    const hasGear = rideTypeHasGear(rideType)
    const untouchedRoad = !hasGear && activity.ride_type == null
    const { updates: gearUpdates, error: validationError } = buildActivityUpdates({
      title: activity.title,
      trackId,
      visibility: activity.visibility,
      description: activity.description,
      rideType: untouchedRoad ? undefined : rideType,
      keepGear: untouchedRoad,
      gears: hasGear ? gears : undefined,
      gearSegments: hasGear ? segments : undefined,
    })
    if (validationError) {
      alert(validationError)
      return
    }
    // Only the setup columns are written here; title/visibility/description are never touched.
    const { title: _t, visibility: _v, description: _d, ...updates } = gearUpdates
    setSavingGear(true)
    setSaveSuccess(false)

    const { error } = await supabase
      .from('activities')
      .update(updates)
      .eq('id', activityId)
      .eq('user_id', activity.user_id)

    setSavingGear(false)
    if (!error) {
      setSaveSuccess(true)
      setActivity((prev) => ({
        ...prev,
        ...updates,
        // A rider edit clears the coach label (the trigger does the same in the database).
        gear_set_by_coach: false,
        tracks: tracks.find((t) => t.id === trackId) || null,
      }))
      setTimeout(() => setSaveSuccess(false), 2500)
    } else {
      alert('Error while saving: ' + error.message)
    }
  }

  // Coach edit of ride type / gears / segments in athlete context, through the audited RPC.
  const handleCoachSaveGear = async (e) => {
    e.preventDefault()
    const hasGear = rideTypeHasGear(rideType)
    const { updates, error: validationError } = buildActivityUpdates({
      title: 'x',
      visibility: 'private',
      rideType,
      gears: hasGear ? gears : undefined,
      gearSegments: hasGear ? segments : undefined,
      keepGear: !hasGear,
    })
    if (validationError) {
      alert(validationError)
      return
    }
    const changes = { ride_type: updates.ride_type }
    if (hasGear) {
      changes.gears = updates.gears
      changes.gear_segments = updates.gear_segments
    }
    setSavingGear(true)
    setSaveSuccess(false)
    const { data, error } = await updateActivityGear(supabase, activityId, changes)
    setSavingGear(false)
    if (error) {
      alert('Error while saving: ' + error.message)
      return
    }
    setSaveSuccess(true)
    setActivity((prev) => ({ ...prev, ...(data || changes) }))
    // Refresh the stamp columns (set_by_coach badge) from the database.
    const { data: fresh } = await supabase
      .from('shared_activities')
      .select('chainring, cog, gear_set_by, gear_set_at, gear_set_by_coach')
      .eq('id', activityId)
      .maybeSingle()
    if (fresh) setActivity((prev) => ({ ...prev, ...fresh }))
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  // Permanent deletion of the activity (issue #18): deletes the DB record (cascading curves/analysis)
  // and any archived .fit file, then returns the user to the Cockpit.
  const handleDeleteActivity = async () => {
    setDeleting(true)
    await removeActivityPhotoFiles(supabase, activity.id).catch(() => {})
    const { error } = await deleteActivity(supabase, activity)
    setDeleting(false)
    setShowDeleteConfirm(false)

    if (error) {
      alert('Error while deleting activity: ' + error.message)
      return
    }

    // Deleting changes records/milestones of later sessions (best effort).
    if (activity.user_id) await syncFeedData(supabase, activity.user_id).catch(() => {})
    router.push(backHref)
  }

  const segmentView = useMemo(() => withSegmentSpeed(activity), [activity])
  const effectiveCurves = useMemo(() => {
    const speed = segmentView.activity?.time_series?.speed
    return segmentView.changed && Array.isArray(speed) ? { ...curvesMap, Speed: computeDurationalCurve(speed) } : curvesMap
  }, [segmentView, curvesMap])
  const rideGears = activity ? resolveGears(activity) : []
  const coachNames = useCoachNames(useMemo(() => (activity ? [activity] : []), [activity]))

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
          href={backHref}
          className="inline-block py-2 px-4 rounded-xl bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold text-xs uppercase"
        >
          {backLabel}
        </Link>
      </div>
    )
  }

  const actWhen = activity.activity_date || activity.created_at
  const isGym = activity.activity_type === 'gym'
  const riderName = authorName(rider)

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <Link
        href={backHref}
        className="inline-flex text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-white transition items-center gap-1.5"
      >
        {backLabel}
      </Link>

      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {rider?.id ? (
            <Link href={`/riders/${rider.id}`} className="shrink-0 rounded-full" aria-label={`${riderName}'s profile`}>
              <Avatar url={rider.avatar_url} name={riderName} size="w-[72px] h-[72px]" textSize="text-2xl" className="ring-2 ring-orange-500 ring-offset-2 ring-offset-white" />
            </Link>
          ) : null}
          <div className="space-y-1 min-w-0">
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
              {activity.title || (activity.activity_type === 'gym' ? 'Gym Session' : 'Velodrome Session')}
            </h1>
            {activity.activity_type === 'gym' && (
              <p className="mt-1 text-xs font-bold text-violet-600 dark:text-violet-400" data-testid="detail-gym-tag">
                Gym session{activity.calories ? ` · ${Math.round(activity.calories)} kcal` : ''}
              </p>
            )}
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
              {rider?.id && (
                <>
                  <Link href={`/riders/${rider.id}`} className="font-black text-slate-700 dark:text-slate-200 hover:text-orange-500 transition">{riderName}</Link>
                  {rider.is_bot && <BotBadge />}
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{fullDateTime(actWhen)}</span>
            </p>
            <RaceTagToggle
              client={supabase}
              activity={activity}
              readOnly={sharedView && !(coachRiderId && coachRiderId === activity?.user_id)}
              onChanged={(fresh) => setActivity((prev) => ({ ...prev, ...fresh }))}
            />
            <ActivityPlannedLink client={supabase} activity={activity} />
            {activity.tracks?.name && (
              <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                {activity.tracks.name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 sm:self-center">
          <CalendarTile date={actWhen} large className="!bg-slate-900 dark:!bg-white/10" />
        {!sharedView && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="py-2 px-4 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase tracking-wider transition"
            >
              <Icon name="edit" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="py-2 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-500 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
            >
              <Icon name="trash" /> Delete Activity
            </button>
          </div>
        )}
        </div>
      </div>

      {activity.description && (
        <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{activity.description}</p>
      )}

      {showDeleteConfirm && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60" role="alertdialog" aria-modal="true" aria-label="Confirm delete">
          <div className="w-full max-w-sm space-y-4 bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl">
            <h2 className="text-base font-black text-slate-900 dark:text-white">Delete this activity?</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This permanently deletes &quot;{activity.title || 'Velodrome Session'}&quot; and all linked data (curves, analysis, photos). This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="py-2 px-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteActivity}
                disabled={deleting}
                className="py-2 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div></Portal>
      )}

      <EditActivityModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        activity={activity}
        tracks={tracks}
        client={supabase}
        onSaved={(updates) => {
          setActivity((prev) => ({ ...prev, ...updates, ...('ride_type' in updates || 'gears' in updates ? { gear_set_by_coach: false } : {}) }))
          setRideType(effectiveRideType(updates.ride_type ?? activity?.ride_type))
          setGears(gearsToForm({ ...activity, ...updates }))
          setSegments(resolveSegments({ ...activity, ...updates }))
          setTrackId(updates.track_id || '')
        }}
      />

      {/* 2. Contextual badges for gear and setup */}
      {(activity.ride_type || rideGears.length > 0 || activity.bike_model || activity.handlebar_setup || activity.helmet || activity.tracks || activity.perceived_exertion) && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
          {activity.tracks && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span><Icon name="velodrome" /></span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {activity.tracks.name} ({activity.tracks.length_m} m)
              </span>
            </div>
          )}
          {(activity.ride_type || rideGears.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-800 dark:text-slate-200">{rideTypeLabel(activity.ride_type)}</span>
              {rideTypeHasGear(activity.ride_type) && rideGears.length > 0 && (
                <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                  {rideGears.map((g, i) => `${gearLabel(g.chainring, g.cog)}${i === 0 && rideGears.length > 1 ? ' (primary)' : ''}`).join(' · ')}
                </span>
              )}
              <CoachBadge row={activity} names={coachNames} />
            </div>
          )}
          {activity.bike_model && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span><Icon name="bike" /></span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.bike_model}</span>
            </div>
          )}
          {activity.handlebar_setup && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span><Icon name="target" /></span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.handlebar_setup}</span>
            </div>
          )}
          {activity.helmet && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span><Icon name="helmet" /></span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{activity.helmet}</span>
            </div>
          )}
          {activity.perceived_exertion && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-500/10 text-orange-500 border border-orange-500/20 font-black">
              <span><Icon name="flame" /></span>
              <span>RPE: {activity.perceived_exertion}/10</span>
            </div>
          )}
        </div>
      )}

      {/* 2b. GPS route map (only for activities with a satellite recording, e.g. road rides) */}
      {Array.isArray(activity.time_series?.latitude) && activity.time_series.latitude.length > 1 && (
        <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Icon name="map" /> Route Map
          </h3>
          <ActivityMap
            latitude={activity.time_series.latitude}
            longitude={activity.time_series.longitude}
          />
        </div>
      )}

      {/* 2c. Photo gallery (issue #49) */}
      <ActivityPhotoGallery activityId={activity.id} ownerId={activity.user_id} />

      {/* 3. Complete set of activity metrics (incl. comparison with the historical maximum - previously
           a separate BenchmarkCards section, now merged here so the metrics don't appear
           in two similarly looking blocks in a row - issue #20) */}
      <ActivityMetricsGrid activity={segmentView.activity} curvesMap={effectiveCurves} masterCurves={masterCurves || {}} />

      {/* 3c. Telemetry chart over time/distance: speed, HR, power, cadence, torque (issue #12) */}
      <ActivityStreamsChart timeSeries={segmentView.activity.time_series} activity={segmentView.activity} highlightWindows={highlightWindows} />

      {/* 3d. Gym sessions: exercises and sets (#326) */}
      {isGym && <GymSessionSection client={supabase} activityId={activity.id} ownerId={activity.user_id} coachContext={inAthleteContext} />}

      {/* 4. Durational Curves Chart: current ride vs. a selectable baseline/"history
           curve" (all-time, last 30/90 days, this calendar year, last floating year,
           or a custom day-picker range) - issue #28 */}
      {!isGym && (
        <DurationalCurvesChart
          curves={effectiveCurves}
          masterCurves={masterCurves}
          baselineCurves={baselineCurves}
          baselineLoading={baselineLoading}
          weightKg={sharedView ? null : weightFromActivity(activity)}
          onPeriodChange={handleBaselinePeriodChange}
        />
      )}

      {/* 4b. Template execution card: Phase 2 declarative evaluation + benchmarking */}
      {!sharedView && !isGym && (
        <TemplateRunsSection activityId={activityId} activity={activity} tracks={tracks} onVisibleWindowsChange={setHighlightWindows} />
      )}
      {/* Athlete context: an active coach runs his own / system templates on the athlete's activity. */}
      {sharedView && !isGym && coachRiderId && coachRiderId === activity?.user_id && (
        <TemplateRunsSection activityId={activityId} activity={activity} tracks={tracks} riderId={coachRiderId} onVisibleWindowsChange={setHighlightWindows} />
      )}

      {/* 4c. Comments: owner, coach and every rider who can see the activity (issues #222-#224) */}
      <ActivityComments activityId={activityId} />

      {/* 5. Bottom panel: velodrome, ride type, gears and gear segments (own activities only) */}
      {!sharedView && !isGym && (
      <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="settings" /> Track & Gearing Setup for this Ride
        </h3>

        <form onSubmit={handleUpdateGear} className="space-y-4">
          <div className="max-w-sm">
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Velodrome
            </label>
            <VelodromePicker tracks={tracks} value={trackId} onChange={setTrackId} emptyLabel="-- No Track Selected --" compact />
          </div>

          <RideGearEditor
            rideType={rideType}
            onRideTypeChange={setRideType}
            gears={gears}
            onGearsChange={setGears}
            segments={segments}
            onSegmentsChange={setSegments}
            timeSeries={activity.time_series}
          />

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingGear}
              className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
            >
              {savingGear ? 'Saving...' : 'Update Setup'}
            </button>
            {saveSuccess && (
              <span className="font-bold text-xs text-emerald-500 animate-fade-in">
                <Icon name="check" /> Setup saved
              </span>
            )}
          </div>
        </form>
      </div>
      )}

      {/* 5b. Coach editor (athlete context): ride type, gears and segments via the audited RPC */}
      {sharedView && !isGym && coachRiderId && coachRiderId === activity?.user_id && (
      <div className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white mb-1 flex items-center gap-2">
          <Icon name="settings" /> Ride type &amp; gears (coach)
        </h3>
        <p className="text-[11px] text-slate-400 mb-4">Edits are labelled as set by you and recorded in the athlete&apos;s audit trail.</p>
        <form onSubmit={handleCoachSaveGear} className="space-y-4">
          <RideGearEditor
            rideType={rideType}
            onRideTypeChange={setRideType}
            gears={gears}
            onGearsChange={setGears}
            segments={segments}
            onSegmentsChange={setSegments}
            timeSeries={activity.time_series}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingGear}
              className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
            >
              {savingGear ? 'Saving...' : 'Save as coach'}
            </button>
            {saveSuccess && (
              <span className="font-bold text-xs text-emerald-500 animate-fade-in">
                <Icon name="check" /> Saved
              </span>
            )}
          </div>
        </form>
      </div>
      )}
    </div>
  )
}
