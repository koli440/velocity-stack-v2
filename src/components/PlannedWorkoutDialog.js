'use client'

import { useMemo, useState } from 'react'
import {
  PLANNED_DESCRIPTION_MAX,
  PLANNED_DISCIPLINES,
  PLANNED_DISCIPLINE_LABELS,
  PLANNED_STATUS_LABELS,
  PLANNED_TITLE_MAX,
  canMoveTo,
  defaultDuplicateDay,
  isDayKey,
  linkableActivities,
  plannedByLabel,
  plannedEditedLabel,
  plannedStatus,
  summarizeStructure,
  validatePlanned,
} from '../lib/plannedWorkouts'
import { dayKey, formatDuration, formatKm } from '../lib/calendar'
import { formatDate } from '../lib/dateFormat'
import { DEFAULT_RUN_KEYS } from '../lib/summaryMetrics'

const field = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm font-normal text-slate-900 dark:text-white'
const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 hover:border-emerald-500 disabled:opacity-60 transition'

export const STATUS_STYLES = {
  planned: 'border-dashed border-sky-400/70 bg-sky-500/10 text-sky-900 dark:text-sky-200',
  completed: 'border-emerald-500/70 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
  skipped: 'border-slate-300 dark:border-slate-600 bg-slate-200/50 dark:bg-slate-700/30 text-slate-500 line-through',
  missed: 'border-rose-400/70 bg-rose-500/10 text-rose-800 dark:text-rose-300',
}

function RunResult({ run }) {
  const entries = DEFAULT_RUN_KEYS.map((k) => [k, run.summary?.[k]]).filter(([, v]) => typeof v === 'number')
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs space-y-1" data-testid="planned-run-result">
      <div className="font-bold text-slate-900 dark:text-white">Template run: {run.template_name}</div>
      {entries.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
          {entries.map(([k, v]) => <span key={k}>{k.replace(/_/g, ' ')}: <b>{Math.round(v * 10) / 10}</b></span>)}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Create / view / edit dialog of a planned workout (`workout` null = create on `day`).
 * `actions` return an Error or null; the calendar reloads after each success.
 * The rider and the rider's active coach may do everything here (the database decides).
 */
export default function PlannedWorkoutDialog({
  workout, day, names, viewerId, templates, activities, workouts, countByDay, suggestedActivityId, run, actions, onClose,
}) {
  const creating = !workout
  const [title, setTitle] = useState(workout?.title || '')
  const [description, setDescription] = useState(workout?.description || '')
  const [discipline, setDiscipline] = useState(workout?.discipline || 'ride')
  const [templateId, setTemplateId] = useState('')
  const [targetDay, setTargetDay] = useState(workout ? workout.workout_date : dayKey(day))
  const [copyDay, setCopyDay] = useState(workout ? defaultDuplicateDay(workout) : '')
  const [linkId, setLinkId] = useState(suggestedActivityId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const status = workout ? plannedStatus(workout) : 'planned'
  const summary = useMemo(() => summarizeStructure(workout?.structure_manifest), [workout])
  const linkable = useMemo(() => (workout ? linkableActivities(workout, workouts, activities) : []), [workout, workouts, activities])
  const linked = workout?.activity_id ? (activities || []).find((a) => a.id === workout.activity_id) : null
  const edited = workout ? plannedEditedLabel(workout, names, viewerId) : null
  const dayLabel = formatDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const run_ = async (fn, { close = false } = {}) => {
    setBusy(true)
    setError(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err.message || 'Something went wrong.')
    else if (close) onClose()
    return !err
  }

  const save = (e) => {
    e.preventDefault()
    const v = validatePlanned({ title, description, discipline, day: targetDay, hasTemplate: creating && !!templateId })
    if (v.error) return setError(v.error)
    return run_(
      () => (creating
        ? actions.create({ day: targetDay, discipline, title, description, templateId: templateId || null })
        : actions.update({ title, description, discipline })),
      { close: true }
    )
  }

  const moveCheck = workout ? canMoveTo(workout, targetDay, countByDay) : { ok: true }
  const copyOk = isDayKey(copyDay) && (countByDay?.[copyDay] || 0) < 20

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 overflow-y-auto" role="dialog" aria-modal="true" aria-label={creating ? 'Plan workout' : 'Planned workout'} onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{creating ? 'Plan workout' : 'Planned workout'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dayLabel}
            {workout && ` · ${plannedByLabel(workout, names, viewerId)}${edited ? ` · ${edited}` : ''}`}
          </p>
          {workout && (
            <span className={`inline-block mt-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${STATUS_STYLES[status]}`} data-testid="planned-status">
              {PLANNED_STATUS_LABELS[status]}
            </span>
          )}
        </div>

        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Title
          <input className={field} value={title} maxLength={PLANNED_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder={creating && templateId ? 'Defaults to the template name' : 'e.g. 4x5 min threshold'} autoFocus />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Discipline
          <select className={field} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            {PLANNED_DISCIPLINES.map((d) => <option key={d} value={d}>{PLANNED_DISCIPLINE_LABELS[d]}</option>)}
          </select>
        </label>
        {creating && (
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
            Day
            <input type="date" className={field} value={targetDay} onChange={(e) => setTargetDay(e.target.value)} />
          </label>
        )}
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          {creating ? 'Structure from template (optional)' : 'Replace structure from template (optional)'}
          <select className={field} value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="planned-template">
            <option value="">{creating ? 'No structure' : 'Keep current structure'}</option>
            {!creating && workout.structure_manifest && <option value="__none__">Remove structure</option>}
            {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.user_id ? '' : ' (system)'}</option>)}
          </select>
        </label>
        {!creating && templateId && (
          <button type="button" className={btn} disabled={busy} onClick={() => run_(() => actions.setTemplate(templateId === '__none__' ? null : templateId)).then((ok) => ok && setTemplateId(''))}>
            Apply structure
          </button>
        )}
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Notes
          <textarea className={`${field} min-h-[5rem]`} value={description} maxLength={PLANNED_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {summary && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-1" data-testid="planned-structure">
            <div className="font-bold text-slate-900 dark:text-white">
              Structure{workout.source_template_name ? ` · ${workout.source_template_name}` : ''}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-slate-600 dark:text-slate-300">{summary.lines.join('\n')}</pre>
            <div className="text-slate-500 dark:text-slate-400">
              {summary.durationS ? `~${formatDuration(summary.durationS)} h${summary.partial ? '+' : ''}` : ''}
              {summary.load ? `${summary.durationS ? ' · ' : ''}load ~${summary.load}` : ''}
              {summary.partial ? ' (distance-based steps not counted)' : ''}
            </div>
            {workout.structure_dsl && (
              <details>
                <summary className="cursor-pointer text-slate-400">Definition</summary>
                <code className="block whitespace-pre-wrap break-words">{workout.structure_dsl}</code>
              </details>
            )}
          </div>
        )}

        {workout && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-2" data-testid="planned-link">
            <div className="font-bold text-slate-900 dark:text-white">Completed activity</div>
            {linked ? (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {linked.title} · {[linked.distanceM ? formatKm(linked.distanceM) : null, linked.durationS ? formatDuration(linked.durationS) : null].filter(Boolean).join(' · ')}
                </span>
                <button type="button" className={btn} disabled={busy} onClick={() => run_(actions.unlink)}>Unlink</button>
              </div>
            ) : workout.activity_id ? (
              <div className="flex items-center justify-between gap-2">
                <span>Linked to an activity outside this month.</span>
                <button type="button" className={btn} disabled={busy} onClick={() => run_(actions.unlink)}>Unlink</button>
              </div>
            ) : (
              <div className="space-y-1">
                {suggestedActivityId && <p className="text-emerald-600 dark:text-emerald-400 font-semibold">Suggested match found (same day and discipline). Confirm or choose another.</p>}
                <div className="flex gap-2">
                  <select className={field.replace('mt-1 ', '')} value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label="Activity to link">
                    <option value="">Choose an activity…</option>
                    {linkable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatDate(a.date, { day: 'numeric', month: 'short' })} · {a.title}{a.id === suggestedActivityId ? ' (suggested)' : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={btn} disabled={busy || !linkId} onClick={() => run_(() => actions.link(linkId))}>Link</button>
                </div>
              </div>
            )}
            {run && <RunResult run={run} />}
          </div>
        )}

        {workout && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-end gap-2">
              <label className="flex-1 font-bold text-slate-600 dark:text-slate-300">
                Move to
                <input type="date" className={field} value={targetDay} onChange={(e) => setTargetDay(e.target.value)} />
              </label>
              <button type="button" className={btn} disabled={busy || !moveCheck.ok} title={moveCheck.ok ? '' : moveCheck.reason} onClick={() => run_(() => actions.move(targetDay), { close: true })}>Move</button>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1 font-bold text-slate-600 dark:text-slate-300">
                Duplicate to
                <input type="date" className={field} value={copyDay} onChange={(e) => setCopyDay(e.target.value)} />
              </label>
              <button type="button" className={btn} disabled={busy || !copyOk} onClick={() => run_(() => actions.duplicate(copyDay), { close: true })}>Copy</button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-400">Only you and your active coach can see planned workouts. The structure is a copy taken when planned.</p>
        {error && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-semibold text-rose-500" role="alert">{error}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {workout && (
              <button type="button" disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-500 border border-rose-500/40 hover:bg-rose-500/10" onClick={() => window.confirm('Delete this planned workout?') && run_(actions.remove, { close: true })}>
                Delete
              </button>
            )}
            {workout && !workout.activity_id && (
              <button type="button" disabled={busy} className={btn} onClick={() => run_(() => actions.skip(workout.status !== 'skipped'), { close: true })}>
                {workout.status === 'skipped' ? 'Unskip' : 'Skip'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btn}>Close</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60">
              {creating ? 'Plan' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
