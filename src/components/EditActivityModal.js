'use client'

import { useEffect, useState } from 'react'
import Portal from './Portal'
import VelodromePicker from './VelodromePicker'
import RideGearEditor from './RideGearEditor'
import { gearsToForm, resolveSegments } from '../lib/gearSegments'
import { effectiveRideType, rideTypeHasGear } from '../lib/rideType'
import { saveActivityRace } from '../lib/raceTag'
import { VISIBILITY_OPTIONS } from '../lib/social'
import {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  updateActivity,
} from '../lib/activityEdit'

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500'

function EditActivityModalInner({ isOpen, onClose, activity, tracks = [], client, onSaved }) {
  const [title, setTitle] = useState('')
  const [trackId, setTrackId] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [rideType, setRideType] = useState('road')
  const [gears, setGears] = useState([])
  const [segments, setSegments] = useState([])
  const [description, setDescription] = useState('')
  const [isRace, setIsRace] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !activity) return
    setTitle(activity.title || '')
    setTrackId(activity.track_id || '')
    setVisibility(activity.visibility || 'private')
    setRideType(activity.activity_type === 'gym' ? 'gym' : effectiveRideType(activity.ride_type))
    setGears(gearsToForm(activity))
    setSegments(resolveSegments(activity))
    setDescription(activity.description || '')
    setIsRace(Boolean(activity.is_race))
    setError('')
  }, [isOpen, activity])

  if (!isOpen || !activity) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const isGym = rideType === 'gym'
    const hasGear = rideTypeHasGear(rideType)
    // An unset ride type is road: leave it (and the hidden gear) alone unless the user picks a type.
    const untouchedRoad = !isGym && !hasGear && activity.ride_type == null
    const { updates, error: err } = await updateActivity(client, activity.id, {
      title,
      trackId,
      visibility,
      description,
      activityType: isGym ? 'gym' : activity.activity_type === 'gym' ? 'ride' : undefined,
      rideType: untouchedRoad || isGym ? undefined : rideType,
      keepGear: untouchedRoad,
      gears: hasGear ? gears : undefined,
      gearSegments: hasGear ? segments : undefined,
    })
    let raceFresh = {}
    if (!err && isRace !== Boolean(activity.is_race)) {
      const { fresh, error: raceErr } = await saveActivityRace(client, activity.id, isRace)
      if (raceErr) {
        setSaving(false)
        setError(`Saved, but the race tag failed: ${raceErr.message}`)
        onSaved?.({ ...updates, tracks: tracks.find((t) => t.id === updates.track_id) || null })
        return
      }
      raceFresh = fresh
    }
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved?.({ ...updates, ...raceFresh, tracks: tracks.find((t) => t.id === updates.track_id) || null })
    onClose()
  }

  const label = 'block text-[10px] uppercase font-bold text-slate-400 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60" role="dialog" aria-modal="true" aria-label="Edit activity">
      <form
        onSubmit={handleSubmit}
        className="glass-modal w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4 bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xl"
      >
        <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">Edit activity</h2>

        <div>
          <label className={label} htmlFor="edit-activity-title">Activity name</label>
          <input
            id="edit-activity-title"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label className={label}>Velodrome (optional)</label>
          <VelodromePicker tracks={tracks} value={trackId} onChange={setTrackId} emptyLabel="-- No Track Selected --" compact />
        </div>

        <div>
          <label className={label} htmlFor="edit-activity-visibility">Privacy</label>
          <select id="edit-activity-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)} className={inputClass}>
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.hint}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={isRace} onChange={(e) => setIsRace(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
          Race
        </label>

        <RideGearEditor
          allowGym
          rideType={rideType}
          onRideTypeChange={setRideType}
          gears={gears}
          onGearsChange={setGears}
          segments={segments}
          onSegmentsChange={setSegments}
          timeSeries={activity.time_series}
        />

        <div>
          <label className={label} htmlFor="edit-activity-description">Description (optional)</label>
          <textarea
            id="edit-activity-description"
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs font-bold text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="py-2 px-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="py-2 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function EditActivityModal(props) {
  return (
    <Portal>
      <EditActivityModalInner {...props} />
    </Portal>
  )
}
