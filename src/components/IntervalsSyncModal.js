'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
  const [hasCredentials, setHasCredentials] = useState(true)

  // Načtení jízd z Intervals.icu při otevření modálu
  useEffect(() => {
    if (!isOpen || !currentUser?.id) return

    const fetchIntervalsList = async () => {
      setLoading(true)
      setErrorMsg(null)

      try {
        // 1. Získání přihlašovacích údajů z profilu
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
        }

        // 2. Volání API route pro seznam jízd
        const res = await fetch('/api/sync/intervals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list',
            athleteId: profile.intervals_athlete_id,
            apiKey: profile.intervals_api_key,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Nepodařilo se načíst jízdy z Intervals.icu.')
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

  // Import konkrétní vybrané jízdy
  const handleImportSelected = async (selectedRide) => {
    if (!currentUser?.id) return
    setImportingId(selectedRide.id)
    setErrorMsg(null)

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('intervals_athlete_id, intervals_api_key, default_chainring, default_cog, crank_length_mm')
        .eq('id', currentUser.id)
        .single()

      // 1. Zavolání API route pro import streamů a křivek (předáváme celé ID jízdy)
      const res = await fetch('/api/sync/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          athleteId: profile.intervals_athlete_id,
          apiKey: profile.intervals_api_key,
          activityId: selectedRide.id,
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Import selhal.')
      }

      const { summary = {}, curves = {}, time_series = {} } = result

      // 2. Vložení do tabulky activities včetně time_series
      const newActivity = {
        user_id: currentUser.id,
        title: selectedRide.name || 'Intervals.icu Sync',
        activity_date: selectedRide.start_date_local,
        distance_m: selectedRide.distance_m || 0,
        moving_time_s: selectedRide.moving_time_s || 0,
        track_id: selectedTrackId || null,
        chainring: profile.default_chainring || 58,
        cog: profile.default_cog || 14,
        crank_length_mm: profile.crank_length_mm || 165.0,
        max_cadence_rpm: summary.max_cadence || null,
        max_speed_kmh: summary.max_speed_kmh || null,
        max_power_w: summary.max_power_w || null,
        peak_torque_nm: summary.peak_torque_nm || null,
        time_series: time_series || {}, // Ukládáme sekundové streamy pro detekci úseků
        wizard_completed: false,
      }

      const { data: actData, error: actErr } = await supabase
        .from('activities')
        .insert([newActivity])
        .select()
        .single()

      if (actErr) throw actErr

      // 3. Vložení zátěžových křivek do activity_curves
      const curveInserts = Object.entries(curves).map(([curveType, curveData]) => ({
        activity_id: actData.id,
        curve_type: curveType,
        data: curveData,
      }))

      if (curveInserts.length > 0) {
        await supabase.from('activity_curves').insert(curveInserts)
      }

      // 4. Úspěšné dokončení a přesměrování
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
        
        {/* Hlavička */}
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
            Vyberte jízdu ze zařízení Garmin nebo Wahoo pro import sekundové telemetrie a spuštění analýzy.
          </p>

          {/* Volba velodromu pro importovanou jízdu */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Přiřadit k velodromu (výchozí):
            </label>
            <select
              value={selectedTrackId}
              onChange={(e) => setSelectedTrackId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
            >
              <option value="">-- Bez určení velodromu --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.length_m} m, {t.surface})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tělo modálu */}
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
                Chybí přihlašovací údaje pro Intervals.icu
              </div>
              <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                Otevřete svůj profil jezdce a zadejte Intervals Athlete ID a API Key.
              </p>
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-xs font-bold uppercase tracking-wider text-slate-400 animate-pulse">
              Načítám poslední jízdy z Intervals.icu...
            </div>
          )}

          {!loading && hasCredentials && activitiesList.length === 0 && !errorMsg && (
            <div className="text-center py-10 text-xs text-slate-400">
              Za posledních 30 dní nebyly na Intervals.icu nalezeny žádné jízdy na kole.
            </div>
          )}

          {!loading && activitiesList.length > 0 && (
            <div className="space-y-2">
              {activitiesList.map((ride) => {
                const isImporting = importingId === ride.id
                const rideDate = new Date(ride.start_date_local).toLocaleDateString('cs-CZ', {
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
                        {ride.name || 'Jízda na kole'}
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
                      {isImporting ? 'Importuji...' : 'Importovat'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Patička */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white transition"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  )
}