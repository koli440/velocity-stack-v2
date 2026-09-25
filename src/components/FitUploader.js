'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FitUploader({
  tracks = [],
  currentUser = null,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileSelected, setFileSelected] = useState(null)
  const [analysis, setAnalysis] = useState(null)

  // Parametry tréninku
  const [title, setTitle] = useState('Velodrome Flying Laps')
  const [selectedTrack, setSelectedTrack] = useState(tracks[0]?.id || '')
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileSelected(file.name)
    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setAnalysis(data)
        setTitle(file.name.replace(/\.[^/.]+$/, ''))
      } else {
        alert(data.error || 'Upload failed')
      }
    } catch (err) {
      alert('Error parsing FIT file: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!analysis || !currentUser) {
      alert('Pro uložení tréninku musíte být přihlášeni.')
      return
    }
    setSaving(true)

    try {
      // 1. Zápis aktivity do tabulky activities
      const { data: activity, error: actError } = await supabase
        .from('activities')
        .insert({
          title: title.trim() || 'Track Session',
          user_id: currentUser.id,
          track_id: selectedTrack || null,
          chainring: chainring ? parseInt(chainring) : null,
          cog: cog ? parseInt(cog) : null,
          crank_length_mm: 165.0,
          max_cadence_rpm: analysis.summary.max_cadence ?? null,
          max_speed_kmh: analysis.summary.max_speed_kmh ?? null,
          max_power_w: analysis.summary.max_power_w ?? null,
          peak_torque_nm: analysis.summary.peak_torque_nm ?? null,
          activity_date: new Date().toISOString(),
        })
        .select()
        .single()

      if (actError) throw actError

      // 2. Zápis křivek do tabulky activity_curves (sloupec data)
      if (analysis.curves && Object.keys(analysis.curves).length > 0) {
        const curveRows = Object.entries(analysis.curves).map(
          ([metricType, metricData]) => ({
            activity_id: activity.id,
            curve_type: metricType,
            data: metricData,
          })
        )

        const { error: curvesError } = await supabase
          .from('activity_curves')
          .insert(curveRows)

        if (curvesError) throw curvesError
      }

      // 3. Předání nového ID zpět pro přesměrování
      if (onSaved) {
        onSaved(activity.id)
      }
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-surface-darkCard p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl relative">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg"
        >
          ✕
        </button>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
          Upload .FIT Workout
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Select raw telemetry file to analyze and save into your vault.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <label className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-500 transition bg-slate-50 dark:bg-slate-900/40">
          <span className="text-2xl mb-1">📁</span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {fileSelected ? fileSelected : 'Choose a .FIT telemetry file'}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5">
            {loading ? 'Analyzing telemetry streams...' : 'Click to browse'}
          </span>
          <input
            type="file"
            accept=".fit"
            onChange={handleFileChange}
            disabled={loading}
            className="hidden"
          />
        </label>

        {analysis && (
          <div className="space-y-4 animate-fade-in pt-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Workout Title
              </label>
              <input
                required
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Velodrome
              </label>
              <select
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Select Velodrome --</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.length_m} m)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Chainring (T)
                </label>
                <input
                  type="number"
                  value={chainring}
                  onChange={(e) => setChainring(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Cog (T)
                </label>
                <input
                  type="number"
                  value={cog}
                  onChange={(e) => setCog(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full mt-2 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-md transition disabled:opacity-50"
            >
              {saving ? 'Saving to Vault...' : 'Save & View Analysis'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}