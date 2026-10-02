'use client'

import { useMemo, useState } from 'react'
import { getAuthHeader } from '../lib/supabase'
import { parseJsonResponse } from '../lib/httpJson'
import {
  DISCIPLINES,
  getDisciplineDistance,
  minutesSecondsToTotalSeconds,
  calculateAvgSpeedKmh,
  countSplits,
} from '../lib/pbVault'

// "Add New Personal Best" form - migrated from v1's expander in pages/30_PB_vault.py. Collects
// discipline + track + time (as separate Min/Sec inputs, like v1) plus optional gear and lap/
// split times, then posts to /api/personal-bests.
export default function AddPbModal({ isOpen, onClose, tracks = [], onSaved }) {
  const [discipline, setDiscipline] = useState(DISCIPLINES[0].name)
  const [trackId, setTrackId] = useState('')
  const [eventName, setEventName] = useState('')
  const [achievedDate, setAchievedDate] = useState(new Date().toISOString().slice(0, 10))
  const [minutes, setMinutes] = useState(4)
  const [seconds, setSeconds] = useState(20)
  const [chainring, setChainring] = useState(52)
  const [cog, setCog] = useState(14)
  const [splitMode, setSplitMode] = useState('laps')
  const [customSplitDistance, setCustomSplitDistance] = useState(500)
  const [lapInputs, setLapInputs] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const selectedTrack = tracks.find((t) => t.id === trackId)
  const distanceM = getDisciplineDistance(discipline)
  const totalSeconds = minutesSecondsToTotalSeconds(minutes, seconds)
  const avgSpeedKmh = calculateAvgSpeedKmh(distanceM, totalSeconds)

  const segmentDistance = splitMode === 'laps' ? selectedTrack?.length_m : customSplitDistance
  const numSplits = useMemo(
    () => countSplits(distanceM, segmentDistance),
    [distanceM, segmentDistance]
  )

  const resetForm = () => {
    setDiscipline(DISCIPLINES[0].name)
    setTrackId('')
    setEventName('')
    setAchievedDate(new Date().toISOString().slice(0, 10))
    setMinutes(4)
    setSeconds(20)
    setChainring(52)
    setCog(14)
    setSplitMode('laps')
    setCustomSplitDistance(500)
    setLapInputs([])
    setNotes('')
    setErrorMsg(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleLapChange = (index, value) => {
    setLapInputs((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const handleSave = async () => {
    if (totalSeconds <= 0) {
      setErrorMsg('Enter a valid time.')
      return
    }

    setSaving(true)
    setErrorMsg(null)

    try {
      const authHeader = await getAuthHeader()
      const lapTimes = lapInputs
        .map((v) => Number(v))
        .filter((v) => v > 0)

      const res = await fetch('/api/personal-bests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          discipline,
          trackId: trackId || null,
          trackName: selectedTrack?.name || null,
          eventName,
          achievedDate,
          timeSeconds: totalSeconds,
          chainring,
          cog,
          splitMode: lapTimes.length ? splitMode : 'laps',
          splitDistanceM: lapTimes.length ? segmentDistance : selectedTrack?.length_m || null,
          lapTimes,
          notes,
        }),
      })

      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to save Personal Best.')
      }

      resetForm()
      onClose()
      if (onSaved) onSaved(json.personalBest)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">
            🏆 Add New Personal Best
          </h2>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg p-1"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Discipline</span>
            <select
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              {DISCIPLINES.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.distanceM}m)
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Track</span>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">No track / other</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.length_m}m, {t.surface})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Event Name</span>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. National Championships"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Date</span>
            <input
              type="date"
              value={achievedDate}
              onChange={(e) => setAchievedDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4 items-end">
          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Min</span>
            <input
              type="number"
              min={0}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Sec</span>
            <input
              type="number"
              min={0}
              max={59.99}
              step={0.01}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>
          <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-xs uppercase font-bold text-slate-400">Calculated Speed</span>
            <div className="text-lg font-black text-emerald-500 dark:text-brand-neon">
              {avgSpeedKmh.toFixed(2)} km/h
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Chainring</span>
            <input
              type="number"
              min={30}
              max={75}
              value={chainring}
              onChange={(e) => setChainring(Number(e.target.value))}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs uppercase font-bold text-slate-400">Cog</span>
            <input
              type="number"
              min={10}
              max={25}
              value={cog}
              onChange={(e) => setCog(Number(e.target.value))}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
          <summary className="text-xs uppercase font-bold text-slate-400 cursor-pointer">
            ⏱️ Add Lap/Split Times (Optional)
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex gap-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={splitMode === 'laps'}
                  onChange={() => setSplitMode('laps')}
                />
                Laps (Track Length)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={splitMode === 'distance'}
                  onChange={() => setSplitMode('distance')}
                />
                Fixed Distance
              </label>
            </div>

            {splitMode === 'distance' && (
              <label className="block space-y-1.5 max-w-xs">
                <span className="text-xs uppercase font-bold text-slate-400">
                  Distance per split (m)
                </span>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  step={100}
                  value={customSplitDistance}
                  onChange={(e) => setCustomSplitDistance(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
            )}

            {numSplits > 0 && (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Enter up to {numSplits} splits of {segmentDistance}m each.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {Array.from({ length: numSplits }).map((_, i) => (
                    <input
                      key={i}
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder={`Split ${i + 1}`}
                      value={lapInputs[i] || ''}
                      onChange={(e) => handleLapChange(i, e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </details>

        <label className="block space-y-1.5">
          <span className="text-xs uppercase font-bold text-slate-400">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
          />
        </label>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save to My Vault'}
        </button>
      </div>
    </div>
  )
}
