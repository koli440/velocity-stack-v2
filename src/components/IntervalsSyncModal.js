'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { buildActivityInsert } from '../lib/activityRecord'
import { findDuplicate, loadExistingActivityFingerprints } from '../lib/activityDuplicates'
import { parseJsonResponse } from '../lib/httpJson'

export default function IntervalsSyncModal({
  isOpen,
  onClose,
  currentUser,
  tracks = [],
  onImportSuccess,
}) {
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)
  const [activitiesList, setActivitiesList] = useState([])
  const [selectedTrackId, setSelectedTrackId] = useState('')
  // Default assumption: a ride assigned to a velodrome is on a fixed-gear (track) bike without
  // freewheel; elsewhere (road) a freewheel is likely instead - so it changes together with the
  // velodrome selection below, but can be overridden (see handleSelectTrack).
  const [isFixedGear, setIsFixedGear] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(true)

  const handleSelectTrack = (trackId) => {
    setSelectedTrackId(trackId)
    setIsFixedGear(!!trackId)
  }

  // Load rides from Intervals.icu when the modal opens
  useEffect(() => {
    if (!isOpen || !currentUser?.id) return

    const fetchIntervalsList = async () => {
      setLoading(true)
      setErrorMsg(null)

      try {
        // 1. Get the credentials from the profile
        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('intervals_athlete_id, intervals_api_key, home_track_id')
          .eq('id', currentUser.id)
          .maybeSingle()

        if (profileErr || !profile?.intervals_athlete_id || !profile?.intervals_api_key) {
          setHasCredentials(false)
          setLoading(false)
          return
        }

        setHasCredentials(true)
        if (profile.home_track_id) {
          setSelectedTrackId(profile.home_track_id)
          setIsFixedGear(true)
        }

        // 2. Call the API route to list rides
        const res = await fetch('/api/sync/intervals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list',
            athleteId: profile.intervals_athlete_id,
            apiKey: profile.intervals_api_key,
          }),
        })

        const data = await parseJsonResponse(res)
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load rides from Intervals.icu.')
        }

        setActivitiesList(data.activities || [])
      } catch (err) {
        setErrorMsg(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchIntervalsList()
  }, [isOpen, currentUser])

  if (!isOpen) return null

  // Import the specific selected ride
  const handleImportSelected = async (selectedRide) => {
    if (!currentUser?.id) return
    setImportingId(selectedRide.id)
    setErrorMsg(null)

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'intervals_athlete_id, intervals_api_key, default_chainring, default_cog, crank_length_mm, ftp_w'
        )
        .eq('id', currentUser.id)
        .single()

      // 1. Call the API route to import the streams and curves (we pass the full ride ID)
      const res = await fetch('/api/sync/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          athleteId: profile.intervals_athlete_id,
          apiKey: profile.intervals_api_key,
          activityId: selectedRide.id,
          // Track bikes are fixed-gear without a speed sensor - the server uses these values
          // to derive speed from cadence if the ride contains no real speedometer data or
          // GPS route, and the user confirmed via the checkbox that the bike is indeed without freewheel.
          chainring: profile.default_chainring || 58,
          cog: profile.default_cog || 14,
          isFixedGear,
        }),
      })

      const result = await parseJsonResponse(res)
      if (!res.ok) {
        throw new Error(result.error || 'Import failed.')
      }

      const { summary = {}, curves = {}, time_series = {} } = result

      // 1b. Guard against re-importing a ride that's already in the vault (issue #41) - this
      // path has no raw .fit file to hash, so duplicates are caught by matching start time +
      // duration against the athlete's existing activities instead.
      const existingFingerprints = await loadExistingActivityFingerprints(supabase, currentUser.id)
      const duplicate = findDuplicate(
        { startTime: summary.start_time, elapsedTimeS: summary.elapsed_time_s },
        existingFingerprints
      )
      if (duplicate) {
        throw new Error(
          'This ride appears to already be in your vault (matching start time/duration). Import blocked to avoid a duplicate.'
        )
      }

      // 2. Insert into the activities table (same mapping logic as a manual upload, see
      // src/lib/activityRecord.js — both import paths produce an identical set of metrics)
      const newActivity = buildActivityInsert(summary, {
        title: selectedRide.name || 'Intervals.icu Sync',
        userId: currentUser.id,
        trackId: selectedTrackId,
        chainring: profile.default_chainring || 58,
        cog: profile.default_cog || 14,
        crankLengthMm: profile.crank_length_mm || 165.0,
        timeSeries: time_series,
        curvesData: curves,
        processingStatus: 'baseline_completed',
        ftpWatts: profile.ftp_w ?? null,
        fallbackActivityDate: selectedRide.start_date_local,
      })

      const { data: actData, error: actErr } = await supabase
        .from('activities')
        .insert([newActivity])
        .select()
        .single()

      if (actErr) throw actErr

      // 3. Insert the load curves into activity_curves
      const curveInserts = Object.entries(curves).map(([curveType, curveData]) => ({
        activity_id: actData.id,
        curve_type: curveType,
        data: curveData,
      }))

      if (curveInserts.length > 0) {
        await supabase.from('activity_curves').insert(curveInserts)
      }

      // 4. Successful completion and redirection
      if (onImportSuccess) {
        onImportSuccess(actData.id)
      }
    } catch (err) {
      setErrorMsg(err.message)
      setImportingId(null)
    }
  }

  const formatMovingTime = (sec) => {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}m ${s < 10 ? '0' : ''}${s}s`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg transition"
          >
            ✕
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">🔄</span>
            <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
              Sync from Intervals.icu
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Select a ride from a Garmin or Wahoo device to import per-second telemetry and run the analysis.
          </p>

          {/* Velodrome selection for the imported ride */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Assign to velodrome (default):
            </label>
            <select
              value={selectedTrackId}
              onChange={(e) => handleSelectTrack(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
            >
              <option value="">-- No velodrome specified --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.length_m} m, {t.surface})
                </option>
              ))}
            </select>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={isFixedGear}
                onChange={(e) => setIsFixedGear(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-orange-500 focus:ring-orange-500"
              />
              Fixed gear (fixed-gear, no freewheel)
            </label>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              This is only used if Intervals.icu does not return a speed sensor or a GPS route -
              speed is then derived from cadence and the gear ratio.
            </p>
          </div>
        </div>

        {/* Modal body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-3">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold">
              ⚠️ {errorMsg}
            </div>
          )}

          {!hasCredentials && (
            <div className="text-center py-8 space-y-2">
              <span className="text-3xl">🔑</span>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Missing Intervals.icu credentials
              </div>
              <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                Open your rider profile and enter the Intervals Athlete ID and API Key.
              </p>
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-xs font-bold uppercase tracking-wider text-slate-400 animate-pulse">
              Loading recent rides from Intervals.icu...
            </div>
          )}

          {!loading && hasCredentials && activitiesList.length === 0 && !errorMsg && (
            <div className="text-center py-10 text-xs text-slate-400">
              No bike rides were found on Intervals.icu in the last 30 days.
            </div>
          )}

          {!loading && activitiesList.length > 0 && (
            <div className="space-y-2">
              {activitiesList.map((ride) => {
                const isImporting = importingId === ride.id
                const rideDate = new Date(ride.start_date_local).toLocaleDateString('en-US', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div
                    key={ride.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-black text-slate-900 dark:text-white">
                        {ride.name || 'Bike Ride'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-semibold flex items-center gap-2">
                        <span>{rideDate}</span>
                        <span>•</span>
                        <span>{formatMovingTime(ride.moving_time_s)}</span>
                        {ride.average_watts && (
                          <>
                            <span>•</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {Math.round(ride.average_watts)} W avg
                            </span>
                          </>
                        )}
                        {ride.average_cadence && (
                          <>
                            <span>•</span>
                            <span>{Math.round(ride.average_cadence)} RPM</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={importingId !== null}
                      onClick={() => handleImportSelected(ride)}
                      className="py-2 px-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-xs uppercase tracking-wider transition shadow-xs disabled:opacity-50 shrink-0"
                    >
                      {isImporting ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}