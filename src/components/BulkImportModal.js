'use client'

import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import { loadExistingActivityFingerprints } from '../lib/activityDuplicates'
import { expandToFitFiles, importFitFilesBatch } from '../lib/bulkImport'

const STATUS_META = {
  success: { icon: '✅', label: 'Imported' },
  skipped: { icon: '⏭️', label: 'Skipped (duplicate)' },
  error: { icon: '❌', label: 'Failed' },
}

export default function BulkImportModal({
  isOpen,
  onClose,
  currentUser,
  tracks = [],
  onImportComplete,
}) {
  const [files, setFiles] = useState([]) // { name, blob, lastModified }
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState([])

  // Global options shared across every file in the batch - same defaults/conventions as
  // FitUploader / IntervalsSyncModal.
  const [selectedTrack, setSelectedTrack] = useState(tracks[0]?.id || '')
  const [chainring, setChainring] = useState('58')
  const [cog, setCog] = useState('14')
  const [isFixedGear, setIsFixedGear] = useState(!!tracks[0]?.id)

  const handleSelectTrack = (trackId) => {
    setSelectedTrack(trackId)
    setIsFixedGear(!!trackId)
  }

  const summary = useMemo(
    () =>
      results.reduce(
        (acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1
          return acc
        },
        { success: 0, skipped: 0, error: 0 }
      ),
    [results]
  )

  const done = !importing && results.length > 0 && results.length === files.length

  if (!isOpen) return null

  const handleFilesPicked = async (e) => {
    const picked = e.target.files
    if (!picked || picked.length === 0) return

    setPickError(null)
    setPicking(true)
    setResults([])

    try {
      const expanded = await expandToFitFiles(picked)
      if (expanded.length === 0) {
        setPickError('No .fit files were found in the selected file(s)/archive.')
      }
      setFiles(expanded)
    } catch (err) {
      setPickError('Could not read the selected archive: ' + err.message)
      setFiles([])
    } finally {
      setPicking(false)
    }
  }

  // Analyze a single file through the same /api/analyze endpoint used by FitUploader/Intervals
  // sync, so every ingestion path shares one metric-computation engine (issue #11).
  const analyzeFile = async (blob, meta) => {
    const formData = new FormData()
    formData.append('file', blob)
    formData.append('chainring', meta.chainring)
    formData.append('cog', meta.cog)
    formData.append('is_fixed_gear', meta.isFixedGear ? 'true' : 'false')

    const res = await fetch('/api/analyze', { method: 'POST', body: formData })
    const data = await parseJsonResponse(res)
    if (!res.ok || data.success === false) {
      throw new Error(data.error || 'Analysis failed')
    }
    return data
  }

  const handleStartImport = async () => {
    if (!currentUser?.id || files.length === 0 || importing) return
    setImporting(true)
    setResults([])

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('ftp_w')
        .eq('id', currentUser.id)
        .maybeSingle()

      // Preload fingerprints of already-imported activities so duplicates (including ones
      // synced earlier from Intervals.icu, or re-running the same archive) are skipped
      // without needing to re-analyze them (issue #41).
      const existingFingerprints = await loadExistingActivityFingerprints(supabase, currentUser.id)

      await importFitFilesBatch({
        files,
        analyzeFile,
        supabase,
        userId: currentUser.id,
        existingFingerprints,
        meta: {
          trackId: selectedTrack,
          chainring,
          cog,
          crankLengthMm: 165.0,
          isFixedGear,
          processingStatus: 'baseline_completed',
          ftpWatts: profile?.ftp_w ?? null,
        },
        onProgress: (result) => setResults((prev) => [...prev, result]),
      })
    } catch (err) {
      setPickError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleDone = () => {
    if (onImportComplete && summary.success > 0) onImportComplete()
    onClose()
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
            <span className="text-base">📦</span>
            <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
              Import Activity History
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Select a .zip export (Strava, Garmin, etc.) or multiple .fit files to bulk-import
            your full ride history.
          </p>

          {/* Options shared across every file in the batch */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Assign to velodrome (default):
              </label>
              <select
                value={selectedTrack}
                onChange={(e) => handleSelectTrack(e.target.value)}
                disabled={importing}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-semibold disabled:opacity-50"
              >
                <option value="">-- No velodrome specified --</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.length_m} m)
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={isFixedGear}
                onChange={(e) => setIsFixedGear(e.target.checked)}
                disabled={importing}
                className="rounded border-slate-300 dark:border-slate-700 text-emerald-500 focus:ring-emerald-500"
              />
              Fixed gear (fixed-gear, no freewheel)
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Chainring (T)
                </label>
                <input
                  type="number"
                  value={chainring}
                  onChange={(e) => setChainring(e.target.value)}
                  disabled={importing}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
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
                  disabled={importing}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 leading-snug">
              Only used when a file has no speed sensor or GPS route - speed is then derived
              from cadence and this gear ratio (fixed-gear bikes only).
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-3">
          {pickError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold">
              ⚠️ {pickError}
            </div>
          )}

          {files.length === 0 && (
            <label className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-500 transition bg-slate-50 dark:bg-slate-900/40">
              <span className="text-2xl mb-1">📁</span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Choose a .zip archive or multiple .fit files
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                {picking ? 'Reading archive...' : 'Click to browse'}
              </span>
              <input
                type="file"
                accept=".fit,.zip"
                multiple
                onChange={handleFilesPicked}
                disabled={picking}
                className="hidden"
              />
            </label>
          )}

          {files.length > 0 && results.length === 0 && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {files.length} .fit file{files.length === 1 ? '' : 's'} ready to import.
              </div>
              <button
                type="button"
                onClick={() => {
                  setFiles([])
                  setPickError(null)
                }}
                disabled={importing}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-white transition disabled:opacity-50"
              >
                Choose different files
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-1.5">
              {results.map((r, idx) => {
                const meta = STATUS_META[r.status]
                return (
                  <div
                    key={`${r.fileName}-${idx}`}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-xs"
                  >
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {r.fileName}
                    </span>
                    <span className="shrink-0 font-bold text-slate-500 dark:text-slate-400">
                      {meta.icon} {r.status === 'error' && r.error ? r.error : meta.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {importing && (
            <div className="text-center py-3 text-xs font-bold uppercase tracking-wider text-slate-400 animate-pulse">
              Importing {results.length + 1} of {files.length}...
            </div>
          )}

          {done && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
              Done: {summary.success} imported, {summary.skipped} skipped (duplicates),{' '}
              {summary.error} failed.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={done ? handleDone : onClose}
            disabled={importing}
            className="py-2 px-4 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white transition disabled:opacity-50"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              type="button"
              onClick={handleStartImport}
              disabled={importing || files.length === 0}
              className="py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-black text-xs uppercase tracking-wider shadow-md transition disabled:opacity-50"
            >
              {importing ? 'Importing...' : `Start Import (${files.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
