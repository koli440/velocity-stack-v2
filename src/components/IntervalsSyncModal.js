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
  const [athleteId, setAthleteId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingKeys, setSavingKeys] = useState(false)
  const [activities, setActivities] = useState([])
  const [selectedActivity, setSelectedActivity] = useState(null)

  // Parametry dráhového kola
  const [selectedTrack, setSelectedTrack] = useState(tracks[0]?.id || '')
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')
  const [importing, setImporting] = useState(false)

  // 1. Načtení uložených klíčů z profilu
  useEffect(() => {
    if (!currentUser?.id) return
    supabase
      .from('profiles')
      .select('intervals_athlete_id, intervals_api_key')
      .eq('id', currentUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          if (data.intervals_athlete_id) setAthleteId(data.intervals_athlete_id)
          if (data.intervals_api_key) setApiKey(data.intervals_api_key)
        }
      })
  }, [currentUser])

  // 2. Uložení klíčů do profilu
  const handleSaveCredentials = async () => {
    if (!currentUser?.id) return
    setSavingKeys(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        intervals_athlete_id: athleteId.trim(),
        intervals_api_key: apiKey.trim(),
      })
      .eq('id', currentUser.id)

    setSavingKeys(false)
    if (error) {
      alert('Chyba při ukládání klíčů: ' + error.message)
    } else {
      alert('Klíče Intervals.icu uloženy!')
      fetchActivities()
    }
  }

  // 3. Načtení seznamu jízd z Intervals.icu
  const fetchActivities = async () => {
    if (!athleteId || !apiKey) {
      alert('Nejprve vyplňte Athlete ID a API Key.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/sync/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          athleteId: athleteId.trim(),
          apiKey: apiKey.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setActivities(data.activities || [])
      } else {
        alert(data.error || 'Nepodařilo se načíst jízdy z Intervals.icu')
      }
    } catch (err) {
      alert('Chyba spojení: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // 4. Import konkrétní jízdy a uložení do VelocityStack DB
  const handleImportActivity = async (act) => {
    setSelectedActivity(act)
    setImporting(true)

    try {
      // Zavoláme backend pro stažení streamů a výpočet křivek
      const res = await fetch('/api/sync/intervals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          athleteId: athleteId.trim(),
          apiKey: apiKey.trim(),
          activityId: act.id,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Chyba při zpracování streamů')
      }

      // 1. Zápis do activities
      const { data: activityRow, error: actError } = await supabase
        .from('activities')
        .insert({
          title: act.name || 'Velodrome Track Session',
          user_id: currentUser.id,
          track_id: selectedTrack || null,
          chainring: chainring ? parseInt(chainring) : null,
          cog: cog ? parseInt(cog) : null,
          crank_length_mm: 165.0,
          max_cadence_rpm: data.summary.max_cadence,
          max_speed_kmh: data.summary.max_speed_kmh,
          max_power_w: data.summary.max_power_w,
          peak_torque_nm: data.summary.peak_torque_nm,
          activity_date: new Date(act.start_date_local).toISOString(),
        })
        .select()
        .single()

      if (actError) throw actError

      // 2. Zápis do activity_curves
      if (data.curves && Object.keys(data.curves).length > 0) {
        const curveRows = Object.entries(data.curves).map(
          ([metricType, metricData]) => ({
            activity_id: activityRow.id,
            curve_type: metricType,
            data: metricData,
          })
        )

        const { error: curvesError } = await supabase
          .from('activity_curves')
          .insert(curveRows)

        if (curvesError) throw curvesError
      }

      alert('🎉 Jízda byla úspěšně synchronizována a zapsána do Vaultu!')
      if (onImportSuccess) {
        onImportSuccess(activityRow.id)
      }
      onClose()
    } catch (err) {
      alert('Import selhal: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-darkCard p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl space-y-6">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg"
        >
          ✕
        </button>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔄</span>
            <h2 className="text-xl font-black uppercase text-slate-900 dark:text-white">
              Intervals.icu Sync Bridge
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Automatický import dráhových tréninků ze zařízení Garmin & Wahoo napojených na Intervals.icu.
          </p>
        </div>

        {/* 1. Nastavení klíčů */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            API Credentials
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Athlete ID (např. i12345)
              </label>
              <input
                type="text"
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
                placeholder="iXXXXX"
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Z profilu Intervals.icu"
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={handleSaveCredentials}
              disabled={savingKeys}
              className="py-1.5 px-3 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-white hover:bg-slate-700 transition"
            >
              {savingKeys ? 'Ukládám...' : 'Save Keys'}
            </button>
            <button
              onClick={fetchActivities}
              disabled={loading}
              className="py-1.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-sm"
            >
              {loading ? 'Načítám...' : 'Fetch Activities'}
            </button>
          </div>
        </div>

        {/* 2. Nastavení převodu pro importované jízdy */}
        <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Velodrom
            </label>
            <select
              value={selectedTrack}
              onChange={(e) => setSelectedTrack(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-white"
            >
              <option value="">-- Oval --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Převodník (T)
            </label>
            <input
              type="number"
              value={chainring}
              onChange={(e) => setChainring(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Pastorek (T)
            </label>
            <input
              type="number"
              value={cog}
              onChange={(e) => setCog(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* 3. Seznam aktivit připravených k importu */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            Recent Workouts ({activities.length})
          </div>

          {activities.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              Žádné jízdy nenačteny. Klikněte na &quot;Fetch Activities&quot;.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {activities.map((act) => (
                <div
                  key={act.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 hover:border-emerald-500 transition"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {act.name}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(act.start_date_local).toLocaleString('cs-CZ')} •{' '}
                      {(act.distance_m / 1000).toFixed(1)} km
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {act.average_watts && (
                      <span className="text-xs font-mono font-bold text-purple-400">
                        {Math.round(act.average_watts)} W
                      </span>
                    )}

                    <button
                      onClick={() => handleImportActivity(act)}
                      disabled={importing}
                      className="py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
                    >
                      {importing && selectedActivity?.id === act.id
                        ? 'Importing...'
                        : 'Sync Ride'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}