'use client'

import { useEffect, useState } from 'react'
import Portal from './Portal'
import VelodromePicker from './VelodromePicker'
import { VISIBILITY_OPTIONS } from '../lib/social'
import {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  gearOptions,
  gearValue,
  updateActivity,
} from '../lib/activityEdit'

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-orange-500'

function EditActivityModalInner({ isOpen, onClose, activity, tracks = [], client, onSaved }) {
  const [title, setTitle] = useState('')
  const [trackId, setTrackId] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [gear, setGear] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !activity) return
    setTitle(activity.title || '')
    setTrackId(activity.track_id || '')
    setVisibility(activity.visibility || 'private')
    setGear(gearValue(activity.chainring, activity.cog))
    setDescription(activity.description || '')
    setError('')
  }, [isOpen, activity])

  if (!isOpen || !activity) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { updates, error: err } = await updateActivity(client, activity.id, {
      title,
      trackId,
      visibility,
      gear,
      description,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved?.({ ...updates, tracks: tracks.find((t) => t.id === updates.track_id) || null })
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

        <div>
          <label className={label} htmlFor="edit-activity-gear">Gear (optional)</label>
          <select id="edit-activity-gear" value={gear} onChange={(e) => setGear(e.target.value)} className={inputClass}>
            <option value="">-- No gear selected --</option>
            {gearOptions(gear).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

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
