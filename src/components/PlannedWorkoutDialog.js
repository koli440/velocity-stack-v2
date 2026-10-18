'use client'

import { useEffect, useMemo, useState } from 'react'
import WorkoutPreviewChart from './WorkoutPreviewChart'
import { ftpAt } from '../lib/ftpHistory'
import PlannedTemplatePicker from './PlannedTemplatePicker'
import { DSL_GUIDE_PATH } from '../lib/dslGuide'
import {
  PLANNED_DESCRIPTION_MAX,
  PLANNED_DISCIPLINES,
  PLANNED_DSL_MAX,
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
  parseStructure,
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
  workout, day, names, viewerId, activities, workouts, countByDay, suggestedActivityId, run, actions, onClose, ftpHistory = [],
}) {
  const creating = !workout
  const [title, setTitle] = useState(workout?.title || '')
  const [description, setDescription] = useState(workout?.description || '')
  const [discipline, setDiscipline] = useState(workout?.discipline || 'ride')
  const [dsl, setDsl] = useState(workout?.structure_dsl || '')
  const [templateName, setTemplateName] = useState(workout?.source_template_name || null)
  const [step, setStep] = useState(workout ? 'form' : 'choose') // choose -> (picker) -> form
  const [picking, setPicking] = useState(false)
  const [targetDay, setTargetDay] = useState(workout ? workout.workout_date : dayKey(day))
  const [copyDay, setCopyDay] = useState(workout ? defaultDuplicateDay(workout) : '')
  const [linkId, setLinkId] = useState(suggestedActivityId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const status = workout ? plannedStatus(workout) : 'planned'
  const parsed = useMemo(() => parseStructure(dsl), [dsl])
  // Keep the last valid structure while the text has errors so the preview does not flicker away.
  const [lastManifest, setLastManifest] = useState(parsed.manifest)
  useEffect(() => {
    if (parsed.manifest) setLastManifest(parsed.manifest)
    else if (parsed.empty) setLastManifest(null)
  }, [parsed])
  const shownManifest = parsed.manifest || (parsed.empty ? null : lastManifest)
  const summary = useMemo(() => (shownManifest ? summarizeStructure(shownManifest) : null), [shownManifest])
  const ftp = useMemo(() => ftpAt(ftpHistory, targetDay), [ftpHistory, targetDay])
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
    if (parsed.errors.length) return setError('Fix the workout definition errors first.')
    const v = validatePlanned({ title, description, discipline, day: targetDay, hasTemplate: !parsed.empty && !!templateName })
    if (v.error) return setError(v.error)
    const structure = { dsl, templateName: parsed.empty ? null : templateName }
    const changed = !creating && (parsed.dsl || '') !== (workout.structure_dsl || '')
    return run_(
      async () => {
        if (creating) return actions.create({ day: targetDay, discipline, title, description, ...structure })
        const err = await actions.update({ title, description, discipline })
        return err || (changed ? actions.setStructure(structure) : null)
      },
      { close: true }
    )
  }

  const moveCheck = workout ? canMoveTo(workout, targetDay, countByDay) : { ok: true }
  const pick = ({ name, dsl: text }) => {
    setDsl(text)
    setTemplateName(name)
    setPicking(false)
    setStep('form')
    if (!title.trim()) setTitle(name.slice(0, PLANNED_TITLE_MAX))
  }

  const copyOk = isDayKey(copyDay) && (countByDay?.[copyDay] || 0) < 20

  if (creating && step === 'choose') {
    const choice = 'rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-left hover:border-emerald-500 transition'
    return (
      <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Plan workout" onClick={onClose}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 shadow-xl">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Plan workout</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{dayLabel}</p>
            </div>
            <button type="button" className={choice} onClick={() => setStep('form')} data-testid="planned-blank">
              <b className="block text-sm text-slate-900 dark:text-white">Blank workout</b>
              <span className="text-xs text-slate-500">Start with an empty definition.</span>
            </button>
            <button type="button" className={choice} onClick={() => setPicking(true)} data-testid="planned-from-template">
              <b className="block text-sm text-slate-900 dark:text-white">From template</b>
              <span className="text-xs text-slate-500">Search your templates and pre-fill the definition.</span>
            </button>
            <button type="button" onClick={onClose} className={btn}>Cancel</button>
          </div>
        </div>
        {picking && <PlannedTemplatePicker userId={viewerId} onPick={pick} onClose={() => setPicking(false)} />}
      </>
    )
  }

  return (
    <>
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
          <input className={field} value={title} maxLength={PLANNED_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder={creating && templateName ? 'Defaults to the template name' : 'e.g. 4x5 min threshold'} autoFocus />
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
        <div className="space-y-1" data-testid="planned-dsl">
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
            <label htmlFor="planned-dsl-text">
              Workout definition (DSL){templateName ? <span className="font-normal text-slate-400"> · based on {templateName}</span> : ''}
            </label>
            <span className="flex items-center gap-2">
              <button type="button" className="text-emerald-600 hover:underline" onClick={() => setPicking(true)}>From template…</button>
              <a href={DSL_GUIDE_PATH} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">DSL guide</a>
            </span>
          </div>
          <textarea
            id="planned-dsl-text"
            className={`${field} mt-0 min-h-[7rem] font-mono text-xs ${parsed.errors.length ? 'border-rose-500' : ''}`}
            value={dsl}
            maxLength={PLANNED_DSL_MAX}
            spellCheck={false}
            aria-invalid={parsed.errors.length > 0}
            placeholder={'Optional, e.g.\n4x\nwork 5min ±30% @ 90-110%FTP\nrecovery 2min ±50% @ <55%FTP'}
            onChange={(e) => setDsl(e.target.value)}
          />
          {parsed.errors.length > 0 && (
            <ul className="text-[11px] font-semibold text-rose-500 space-y-0.5" role="alert" data-testid="planned-dsl-errors">
              {parsed.errors.slice(0, 5).map((er, i) => <li key={i}>{er.line ? `Line ${er.line}: ` : ''}{er.message}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-slate-400">A template only pre-fills this box. The workout keeps its own copy that you can edit freely.</p>
        </div>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Notes
          <textarea className={`${field} min-h-[5rem]`} value={description} maxLength={PLANNED_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {summary && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-1" data-testid="planned-structure">
            <div className="font-bold text-slate-900 dark:text-white">Structure</div>
            <WorkoutPreviewChart manifest={shownManifest} ftp={ftp} />
            {parsed.errors.length > 0 && <div className="text-[11px] font-semibold text-amber-600">Showing the last valid version of the definition.</div>}
            <pre className="whitespace-pre-wrap font-sans text-slate-600 dark:text-slate-300">{summary.lines.join('\n')}</pre>
            <div className="text-slate-500 dark:text-slate-400">
              {summary.durationS ? `~${formatDuration(summary.durationS)} h${summary.partial ? '+' : ''}` : ''}
              {summary.load ? `${summary.durationS ? ' · ' : ''}load ~${summary.load}` : ''}
              {summary.partial ? ' (distance-based steps not counted)' : ''}
            </div>
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
                {linkable.length === 0 && <p className="text-slate-500">No activities on this day.</p>}
                {suggestedActivityId && <p className="text-emerald-600 dark:text-emerald-400 font-semibold">Suggested match found (same day and discipline). Confirm or choose another.</p>}
                <div className="flex gap-2">
                  <select className={field.replace('mt-1 ', '')} value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label="Activity to link">
                    <option value="">Choose an activity…</option>
                    {linkable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatDate(a.date, { hour: '2-digit', minute: '2-digit' })} · {a.title}{a.id === suggestedActivityId ? ' (suggested)' : ''}
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
    {picking && <PlannedTemplatePicker userId={viewerId} onPick={pick} onClose={() => setPicking(false)} />}
    </>
  )
}
