'use client'

import { useMemo, useState } from 'react'
import {
  RACE_NAME_MAX,
  RACE_LOCATION_MAX,
  RACE_FORMAT_MAX,
  RACE_NOTES_MAX,
  RACE_DISCIPLINES,
  RACE_DISCIPLINE_LABELS,
  RACE_PRIORITIES,
  RACE_PRIORITY_LABELS,
  raceAuthorLabel,
  raceEditedLabel,
  raceTimeLabel,
  validateRace,
  linkableRaceActivities,
  checkRaceLink,
} from '../lib/calendarRaces'
import { formatDate } from '../lib/dateFormat'
import { formatDuration, formatKm } from '../lib/calendar'

// Add / view / edit / delete dialog of a race. `race` is null when adding. Both the rider and the rider's active
// coach may edit and delete any race (the database decides). A race can be linked to an activity of its day.
export default function CalendarRaceDialog({ race, day, dayLabel, names, viewerId, activities, races, onSave, onDelete, onClose }) {
  const [date, setDate] = useState(day)
  const [name, setName] = useState(race?.name || '')
  const [discipline, setDiscipline] = useState(race?.discipline || 'ride')
  const [priority, setPriority] = useState(race?.priority || 'B')
  const [time, setTime] = useState(race?.race_time ? String(race.race_time).slice(0, 5) : '')
  const [location, setLocation] = useState(race?.location || '')
  const [formatNote, setFormatNote] = useState(race?.format_note || '')
  const [notes, setNotes] = useState(race?.notes || '')
  const [activityId, setActivityId] = useState(race?.activity_id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const linkable = useMemo(() => linkableRaceActivities(race, races, activities, date), [race, races, activities, date])
  const linkedKnown = activityId && (activities || []).some((a) => a.id === activityId)

  const submit = async (e) => {
    e.preventDefault()
    const v = validateRace({ name, discipline, priority, time, location, formatNote, notes, activityId })
    if (v.error) return setError(v.error)
    const linkErr = checkRaceLink({ day: date, activityId, currentActivityId: race?.activity_id, currentDay: race?.race_date, activities })
    if (linkErr) return setError(linkErr)
    setBusy(true)
    setError(null)
    const err = await onSave({ day: date, name, discipline, priority, time, location, formatNote, notes, activityId })
    setBusy(false)
    if (err) setError(err.message || 'Could not save the race.')
  }

  const remove = async () => {
    if (!window.confirm('Delete this race?')) return
    setBusy(true)
    const err = await onDelete()
    setBusy(false)
    if (err) setError(err.message || 'Could not delete the race.')
  }

  const field = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white'
  const label = 'block text-xs font-bold text-slate-600 dark:text-slate-300'
  const edited = race ? raceEditedLabel(race, names, viewerId) : null
  const timeLabel = raceTimeLabel(race)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={race ? 'Race' : 'Add race'}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 shadow-xl"
      >
        <div>
          <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{race ? 'Race' : 'Add race'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dayLabel}
            {timeLabel && ` · ${timeLabel}`}
            {race && ` · by ${raceAuthorLabel(race, names, viewerId)}${edited ? ` · ${edited}` : ''}`}
          </p>
        </div>
        <label className={label}>
          Name
          <input className={field} value={name} maxLength={RACE_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="e.g. National track championships" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Date
            <input
              type="date"
              className={field}
              value={date}
              onChange={(e) => {
                const next = e.target.value
                if (!next) return
                setDate(next)
                // Same-day rule: a link to an activity of another day is dropped (an unverifiable one is kept only on the same date).
                if (activityId && checkRaceLink({ day: next, activityId, currentActivityId: race?.activity_id, currentDay: race?.race_date, activities })) setActivityId('')
              }}
            />
          </label>
          <label className={label}>
            Start time (optional)
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className={label}>
            Discipline
            <select className={field} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
              {RACE_DISCIPLINES.map((d) => <option key={d} value={d}>{RACE_DISCIPLINE_LABELS[d]}</option>)}
            </select>
          </label>
          <label className={label}>
            Priority
            <select className={field} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
              {RACE_PRIORITIES.map((p) => <option key={p} value={p}>{RACE_PRIORITY_LABELS[p]}</option>)}
            </select>
          </label>
        </div>
        <label className={label}>
          Location (optional)
          <input className={field} value={location} maxLength={RACE_LOCATION_MAX} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className={label}>
          Distance / format (optional)
          <input className={field} value={formatNote} maxLength={RACE_FORMAT_MAX} onChange={(e) => setFormatNote(e.target.value)} placeholder="e.g. 120 km road race, 40 min points race" />
        </label>
        <label className={label}>
          Notes
          <textarea className={`${field} min-h-[4rem]`} value={notes} maxLength={RACE_NOTES_MAX} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {race && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-1" data-testid="race-link">
            <div className="font-bold text-slate-900 dark:text-white">Race activity</div>
            {activityId && !linkedKnown && <p className="text-slate-500">Linked to an activity outside this month.</p>}
            {linkable.length === 0 && !activityId && <p className="text-slate-500">No activities on this day to link.</p>}
            {(linkable.length > 0 || activityId) && (
              <select className={field} value={activityId} onChange={(e) => setActivityId(e.target.value)} aria-label="Race activity">
                <option value="">Not linked</option>
                {activityId && !linkedKnown && <option value={activityId}>Linked activity</option>}
                {linkable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDate(a.date, { hour: '2-digit', minute: '2-digit' })} · {a.title}
                    {a.distanceM || a.durationS ? ` · ${[a.distanceM ? formatKm(a.distanceM) : null, a.durationS ? formatDuration(a.durationS) : null].filter(Boolean).join(' · ')}` : ''}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-slate-400">Only activities of the race day can be linked; the linked ride is marked as the race on the calendar.</p>
          </div>
        )}
        <p className="text-[11px] text-slate-400">Only you and your active coach can see races.</p>
        {error && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-semibold text-rose-500">{error}</div>}
        <div className="flex items-center justify-between gap-2">
          {race ? (
            <button type="button" disabled={busy} onClick={remove} className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-500 border border-rose-500/40 hover:bg-rose-500/10">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
