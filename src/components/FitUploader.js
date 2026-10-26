'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildActivityInsert } from '../lib/activityRecord'
import { autoLinkActivity, localDayOf } from '../lib/plannedWorkouts'
import { prepareAnalysis } from '../lib/gymAnalysis'
import { saveGymDetail, buildGymDetail, gymTotals } from '../lib/gymDetail'
import { isGymActivity } from '../lib/activityType'
import { fetchWeightHistory } from '../lib/weightHistory'
import { fetchFtpHistory } from '../lib/ftpHistory'
import { findDuplicate, loadExistingActivityFingerprints } from '../lib/activityDuplicates'
import VelodromePicker from './VelodromePicker'
import GearPicker, { useGearState } from './GearPicker'
import RideTypeSelect, { useRideTypeState } from './RideTypeSelect'
import { rideTypeHasGear } from '../lib/rideType'
import { parseGear } from '../lib/gear'
import Icon from './Icon'

export default function FitUploader({
  tracks = [],
  currentUser = null,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileSelected, setFileSelected] = useState(null)
  const [rawFile, setRawFile] = useState(null)
  const [analysis, setAnalysis] = useState(null)

  // Workout parameters
  const [title, setTitle] = useState('Velodrome Flying Laps')
  const [selectedTrack, setSelectedTrack] = useState('')
  const { gear, setGear } = useGearState(currentUser?.id)
  const { chainring, cog } = gear
  // Default assumption: a ride on the selected velodrome is on a fixed-gear (track) bike
  // without freewheel; elsewhere (road) a freewheel is likely. Can be overridden with the checkbox below.
  const [isFixedGear, setIsFixedGear] = useState(false)
  const [rideType, setRideType] = useRideTypeState(currentUser?.id)

  const handleTrackChange = (trackId) => {
    setSelectedTrack(trackId)
    setIsFixedGear(!!trackId)
    if (rawFile) runAnalyze(rawFile, chainring, cog, !!trackId)
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileSelected(file.name)
    setRawFile(file)
    setTitle(file.name.replace(/\.[^/.]+$/, ''))
    await runAnalyze(file, chainring, cog, isFixedGear)
  }

  // Trigger (or recompute) the analysis on the server. We always send chainring/cog and
  // is_fixed_gear based on the checkbox below - the server uses these values to derive speed
  // from cadence only when the .fit file contains no real speed or GPS route (see api/analyze.py).
  const runAnalyze = async (file, chainringVal, cogVal, isFixedGearVal = isFixedGear) => {
    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    // Gear is optional; an empty or invalid gear is simply not sent (no speed derivation then).
    const g = parseGear(chainringVal, cogVal)
    if (g.valid && !g.empty) {
      formData.append('chainring', g.chainring)
      formData.append('cog', g.cog)
    }
    formData.append('is_fixed_gear', isFixedGearVal ? 'true' : 'false')

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setAnalysis(data)
      } else {
        alert(data.error || 'Upload failed')
      }
    } catch (err) {
      alert('Error parsing FIT file: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // If speed was derived from cadence (no speed sensor or GPS in the file),
  // we recompute it after the gear ratio is edited - otherwise it would stay computed with the previous gear ratio.
  const handleGearBlur = () => {
    if (rawFile && analysis?.summary?.speed_source === 'derived_from_cadence') {
      runAnalyze(rawFile, chainring, cog, isFixedGear)
    }
  }

  const handleRideType = (value) => {
    setRideType(value)
    if (rideTypeHasGear(value) && !isFixedGear) handleFixedGearChange(true)
  }

  const handleFixedGearChange = (checked) => {
    setIsFixedGear(checked)
    if (rawFile) runAnalyze(rawFile, chainring, cog, checked)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!analysis || !currentUser) {
      alert('You must be signed in to save the workout.')
      return
    }
    if (!parseGear(chainring, cog).valid) {
      alert(parseGear(chainring, cog).error)
      return
    }
    setSaving(true)

    try {
      // 0a. Compute the raw file's hash up front (before uploading/inserting anything) so we
      // can check for a duplicate (issue #41) without wasting a Storage upload on a ride that
      // already exists for this athlete.
      let fileSha256 = null
      if (rawFile) {
        const digestBuffer = await crypto.subtle.digest('SHA-256', await rawFile.arrayBuffer())
        fileSha256 = Array.from(new Uint8Array(digestBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }

      const existingFingerprints = await loadExistingActivityFingerprints(supabase, currentUser.id)
      const duplicate = findDuplicate(
        {
          fileSha256,
          startTime: analysis.summary?.start_time,
          elapsedTimeS: analysis.summary?.elapsed_time_s,
        },
        existingFingerprints
      )
      if (duplicate) {
        alert('This activity appears to already be in your vault (same file or matching start time/duration). Import blocked to avoid a duplicate.')
        setSaving(false)
        return
      }

      // 0b. Archive the unmodified raw .fit file to Supabase Storage (Phase 1)
      let rawFileUrl = null
      if (rawFile) {
        const storagePath = `${currentUser.id}/${Date.now()}-${rawFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('raw-activity-files')
          .upload(storagePath, rawFile, { contentType: 'application/octet-stream' })

        if (uploadError) {
          console.warn('Raw .fit archive upload failed:', uploadError.message)
        } else {
          rawFileUrl = storagePath
        }
      }

      // 1. Write the activity into the activities table
      const { data: profile } = await supabase
        .from('profiles')
        .select('ftp_w')
        .eq('id', currentUser.id)
        .maybeSingle()
      const { history: ftpHistory } = await fetchFtpHistory(supabase, currentUser.id)
      const { history: weightHistory } = await fetchWeightHistory(supabase, currentUser.id)

      const prepared = prepareAnalysis(analysis)
      const activityRecord = buildActivityInsert(prepared.summary, {
        title,
        userId: currentUser.id,
        trackId: selectedTrack,
        rideType,
        chainring: parseGear(chainring, cog).chainring,
        cog: parseGear(chainring, cog).cog,
        crankLengthMm: 165.0,
        timeSeries: prepared.time_series,
        curvesData: prepared.curves,
        activityType: prepared.activityType,
        rawFileUrl,
        fileSha256,
        processingStatus: 'baseline_completed',
        ftpWatts: profile?.ftp_w ?? null,
        ftpHistory,
        weightHistory,
      })

      const { data: activity, error: actError } = await supabase
        .from('activities')
        .insert(activityRecord)
        .select()
        .single()

      if (actError) throw actError

      // 2. Write the curves into the activity_curves table (data column)
      if (prepared.curves && Object.keys(prepared.curves).length > 0) {
        const curveRows = Object.entries(prepared.curves).map(
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

      if (prepared.gym) {
        const gymError = await saveGymDetail(supabase, prepared.gym, { activityId: activity.id, userId: currentUser.id })
        if (gymError) console.warn('Saving exercises and sets failed:', gymError.message)
      }

      // Link to the same-day planned workout when the choice is clear (the browser knows the local day).
      await autoLinkActivity(supabase, { activity, localDay: localDayOf(activity.activity_date) })

      // 3. Pass the new ID back for redirection
      if (onSaved) {
        onSaved(activity.id)
      }
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const isGym = isGymActivity(analysis?.summary)
  const gymTotal = isGym ? gymTotals(buildGymDetail(analysis?.strength)) : null

  return (
    <div className="glass-dense bg-white dark:bg-surface-darkCard p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl relative">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg"
        >
          <Icon name="close" size={18} />
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
          <span className="mb-1 text-slate-400"><Icon name="folder" size={28} /></span>
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

            {isGym && (
              <div className="flex items-start gap-1.5 p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 text-[11px] font-semibold">
                <span>🏋️</span>
                <span>
                  This is a gym / strength session. Duration, heart rate and calories
                  {gymTotal?.sets ? `, ${gymTotal.exercises} exercises and ${gymTotal.sets} sets` : ''} are saved;
                  it is kept apart from ride stats and fitness load.
                </span>
              </div>
            )}

            {!isGym && (<>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Velodrome
              </label>
              <VelodromePicker tracks={tracks} value={selectedTrack} onChange={handleTrackChange} defaultToFavorite emptyLabel="-- Select Velodrome --" compact />
            </div>

            <RideTypeSelect value={rideType} onChange={handleRideType} />

            <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={isFixedGear}
                onChange={(e) => handleFixedGearChange(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-emerald-500 focus:ring-emerald-500"
              />
              Fixed gear (fixed-gear, no freewheel)
            </label>

            {(rideTypeHasGear(rideType) || isFixedGear) && (
              <GearPicker
                label="Gear (optional)"
                chainring={chainring}
                cog={cog}
                onChange={setGear}
                onBlur={handleGearBlur}
                showStats
              />
            )}

            {analysis?.summary?.speed_source === 'gps' && (
              <div className="flex items-start gap-1.5 p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400 text-[11px] font-semibold">
                <span><Icon name="pin" /></span>
                <span>
                  This file does not contain a speed sensor - speed, distance and moving time
                  are derived from the GPS route.
                </span>
              </div>
            )}

            {analysis?.summary?.speed_source === 'derived_from_cadence' && (
              <div className="flex items-start gap-1.5 p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400 text-[11px] font-semibold">
                <span>ℹ️</span>
                <span>
                  This file does not contain a speed sensor or a GPS route - speed, distance
                  and moving time are derived from cadence and the entered gear ratio (only for
                  fixed-gear bikes). Adjust the chainring/cog above for a more accurate estimate.
                </span>
              </div>
            )}

            {analysis?.summary?.speed_source === 'unavailable' && (
              <div className="flex items-start gap-1.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-semibold">
                <span><Icon name="alert" /></span>
                <span>
                  This file does not contain a speed sensor, a GPS route, or fixed-gear confirmation
                  - speed, distance and moving time cannot be reliably derived, so they are not
                  shown. If this is a track (fixed-gear) bike, check the box above.
                </span>
              </div>
            )}
            </>)}

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