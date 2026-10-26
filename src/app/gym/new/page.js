'use client'

// Manual gym session (issue #335): date, title, duration and notes first, then the exercise / set editor.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { buildActivityInsert } from '../../../lib/activityRecord'
import GymSessionEditor, { useWeightUnit } from '../../../components/GymSessionEditor'

const pad = (n) => String(n).padStart(2, '0')
const nowLocalInput = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const field = 'w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-violet-500'

export default function NewGymSessionPage() {
  const router = useRouter()
  const [userId, setUserId] = useState(null)
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(nowLocalInput)
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [activityId, setActivityId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unit, setUnit] = useWeightUnit()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null)).catch(() => {})
  }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!userId) return setError('Sign in to log a session')
    const mins = minutes === '' ? null : Number(minutes)
    if (mins != null && (!Number.isFinite(mins) || mins < 0 || mins > 1440)) return setError('Duration must be 0-1440 minutes')
    const date = new Date(when)
    if (Number.isNaN(date.getTime())) return setError('Pick a valid date and time')
    setSaving(true)
    setError('')
    const seconds = mins == null ? null : Math.round(mins * 60)
    const record = {
      ...buildActivityInsert(
        { activity_type: 'gym', start_time: date.toISOString(), elapsed_time_s: seconds, moving_time_s: seconds },
        { title, userId, activityType: 'gym', source: 'manual' },
      ),
      description: notes.trim() || null,
    }
    const { data, error: err } = await supabase.from('activities').insert(record).select('id').single()
    setSaving(false)
    if (err) return setError(err.message)
    setActivityId(data.id)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <Link href="/" className="inline-flex text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-white">← Cockpit</Link>
      <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">Log a gym session</h1>

      {!activityId ? (
        <form onSubmit={create} className="space-y-4 bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder" data-testid="gym-new-form">
          <label className="block space-y-1"><span className="text-xs uppercase font-bold text-slate-400">Title</span>
            <input className={field} value={title} maxLength={120} placeholder="Gym Session" onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1"><span className="text-xs uppercase font-bold text-slate-400">Date &amp; time</span>
              <input className={field} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
            <label className="block space-y-1"><span className="text-xs uppercase font-bold text-slate-400">Duration (min)</span>
              <input className={field} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
          </div>
          <label className="block space-y-1"><span className="text-xs uppercase font-bold text-slate-400">Notes</span>
            <textarea className={field} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <p className="text-xs font-bold text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-black uppercase disabled:opacity-50">
            {saving ? 'Creating…' : 'Add exercises & sets'}
          </button>
        </form>
      ) : (
        <GymSessionEditor
          client={supabase}
          activityId={activityId}
          ownerId={userId}
          detail={null}
          unit={unit}
          onUnit={setUnit}
          onCancel={() => router.push(`/activities/${activityId}`)}
          onSaved={() => router.push(`/activities/${activityId}`)}
        />
      )}
    </div>
  )
}
