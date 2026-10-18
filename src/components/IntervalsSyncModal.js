'use client'

import { useState, useEffect } from 'react'
import Portal from './Portal'
import { formatDateTime } from '../lib/dateFormat'
import { supabase, getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import VelodromePicker from './VelodromePicker'
import Icon from './Icon'

function IntervalsSyncModalInner({
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
        const [{ data: profile, error: profileErr }, { data: conn }, { data: secrets }] = await Promise.all([
          supabase.from('profiles').select('home_track_id').eq('id', currentUser.id).maybeSingle(),
          supabase
            .from('connections')
            .select('status')
            .eq('user_id', currentUser.id)
            .eq('provider', 'intervals')
            .maybeSingle(),
          supabase
            .from('profile_secrets')
            .select('intervals_athlete_id, intervals_api_key')
            .eq('user_id', currentUser.id)
            .maybeSingle(),
        ])
        const connected = conn ? conn.status !== 'disconnected' : false
        const legacy = !!(secrets?.intervals_athlete_id && secrets?.intervals_api_key) && conn?.status !== 'disconnected'

        if (profileErr || !(connected || legacy)) {
          setHasCredentials(false)
          setLoading(false)
          return
        }

        setHasCredentials(true)
        if (profile?.home_track_id) {
          setSelectedTrackId(profile.home_track_id)
          setIsFixedGear(true)
        }

        // 2. Call the API route to list rides
        const res = await fetch('/api/sync/intervals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
          body: JSON.stringify({ action: 'list' }),
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

  // Import the specific selected ride. The server fetches, analyzes, de-duplicates (upgrading a
  // lower-priority copy of the same ride when applicable) and saves it; credentials and the user
  // identity are resolved server-side from the session.
  const handleImportSelected = async (selectedRide) => {
    if (!currentUser?.id) return
    setImportingId(selectedRide.id)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/sync/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          action: 'import',
          activityId: selectedRide.id,
          trackId: selectedTrackId || null,
          // Used server-side to derive speed from cadence only when the ride has no speed
          // sensor or GPS route and the user confirmed the bike is fixed-gear.
          isFixedGear,
        }),
      })

      const result = await parseJsonResponse(res)
      if (!res.ok) {
        throw new Error(result.error || 'Import failed.')
      }

      if (onImportSuccess) {
        onImportSuccess(result.activityId)
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
      <div className="glass-modal relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-surface-darkCard rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg transition"
          >
            <Icon name="close" size={18} />
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className="text-base"><Icon name="refresh" size={18} /></span>
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
            <VelodromePicker tracks={tracks} value={selectedTrackId} onChange={handleSelectTrack} emptyLabel="-- No velodrome specified --" compact />
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
              <Icon name="alert" /> {errorMsg}
            </div>
          )}

          {!hasCredentials && (
            <div className="text-center py-8 space-y-2">
              <span className="text-slate-400"><Icon name="key" size={30} /></span>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Missing Intervals.icu credentials
              </div>
              <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                Open your rider profile and connect Intervals.icu under Connections.
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
              No bike rides were found in your Intervals.icu import window (change it in profile settings).
            </div>
          )}

          {!loading && activitiesList.length > 0 && (
            <div className="space-y-2">
              {activitiesList.map((ride) => {
                const isImporting = importingId === ride.id
                const rideDate = formatDateTime(ride.start_date_local, {
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
export default function IntervalsSyncModal(props) {
  return (
    <Portal>
      <IntervalsSyncModalInner {...props} />
    </Portal>
  )
}
