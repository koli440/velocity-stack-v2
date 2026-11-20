'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useAthlete } from '../../../../components/AthleteContext'
import { useMacroPlanner } from '../../../../components/useMacroPlanner'
import { useFitnessData } from '../../../../components/useFitnessData'
import { ProjectionChart, WeeklyTargetChart } from '../../../../components/MacroPlanChart'
import Icon from '../../../../components/Icon'
import { ErrorNote, StatusNote, StatusBadge, adminBtn, adminCard, adminInput, adminMuted } from '../../../../components/admin/AdminUi'
import { fetchMacroPlan, saveMacroPlan, publishMacroPlan, deleteMacroPlan, macroPlanSaveMessage } from '../../../../lib/macroPlannerFlag'
import {
  TEMPLATES,
  DEFAULT_RAMP_CEILING_PCT,
  computeBaseline,
  generatePlan,
  projectPlan,
  assessFeasibility,
  chartRows,
  actualWeekTl,
} from '../../../../lib/macroPlanner'

const input = `${adminInput} !py-2`
const LENGTHS = { short: 'Short (up to ~2 h)', medium: 'Medium (2-5 h)', long: 'Long (5-10 h)', ultra: 'Ultra (10 h+)' }
const KINDS = { build: 'Build', recovery: 'Recovery', taper: 'Taper' }
const SHAPE_NEXT = { H: 'E', E: 'R', R: 'H' }
const SHAPE_CLASS = {
  H: 'bg-orange-500 border-orange-500 text-white',
  E: 'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100',
  R: 'bg-slate-100 border-slate-300 text-slate-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400',
}
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const VERDICT = {
  ok: { tone: 'good', label: 'Realistic', text: 'The planned ramp is within what the athlete has sustained.' },
  stretch: { tone: 'warn', label: 'Stretch', text: 'The planned ramp is above what the athlete has sustained. Possible, but watch fatigue.' },
  unrealistic: { tone: 'bad', label: 'Unrealistic', text: 'The planned ramp is well above what the athlete has sustained (or above the platform\u2019s rapid-ramp limit).' },
}
const WARNING_TEXT = {
  ceiling: (w) => `Week of ${w.week_start} is above the ramp ceiling.`,
  no_recovery: (w) => `${w.weeks} build weeks in a row without a recovery week.`,
}

const defaults = { raceName: '', raceDate: '', raceLength: 'medium', template: '3+1', buildWeeks: 3, recoveryWeeks: 1, ceiling: DEFAULT_RAMP_CEILING_PCT, startTl: '', goalCtl: '' }

// Coach planner for one athlete: one A race, weekly TL targets (no workouts), projection and feasibility.
export default function AthletePlannerPage() {
  const { riderId, athlete } = useAthlete()
  const enabled = useMacroPlanner()
  const { daily, loading: fitLoading, error: fitError, today } = useFitnessData(riderId, 120, { coach: true })
  const [plan, setPlan] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(defaults)
  const [weeks, setWeeks] = useState([])
  const [goalReachable, setGoalReachable] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const baseline = useMemo(() => computeBaseline(daily, today), [daily, today])

  const hydrate = useCallback((p) => {
    setPlan(p)
    if (!p) return
    setForm({
      raceName: p.race_name, raceDate: p.race_date, raceLength: p.race_length, template: p.template, buildWeeks: p.build_weeks,
      recoveryWeeks: p.recovery_weeks, ceiling: Number(p.ramp_ceiling_pct), startTl: String(p.start_weekly_tl), goalCtl: p.goal_ctl ? String(p.goal_ctl) : '',
    })
    setWeeks(p.weeks || [])
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    if (!riderId) return
    const res = await fetchMacroPlan(supabase, riderId)
    if (res.error) setError(macroPlanSaveMessage(res.error))
    else hydrate(res.plan)
    setLoaded(true)
  }, [riderId, hydrate])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  // Suggest the baseline weekly TL once, for a new plan.
  useEffect(() => {
    if (loaded && !plan && baseline.status === 'history' && !form.startTl) setForm((f) => ({ ...f, startTl: String(baseline.weeklyTl) }))
  }, [loaded, plan, baseline, form.startTl])

  const startTl = Number(form.startTl) || 0
  const baselineSource = baseline.status === 'history' && Number(form.startTl) === baseline.weeklyTl ? 'history' : 'manual'

  const projection = useMemo(
    () => (weeks.length ? projectPlan({ weeks, days: daily, today, raceDate: form.raceDate, startWeeklyTl: startTl, baselineStatus: baseline.status }) : null),
    [weeks, daily, today, form.raceDate, startTl, baseline.status]
  )
  const feasibility = useMemo(
    () => (projection ? assessFeasibility({ weeks, projection, sustained: baseline.sustainedRamp, rampCeilingPct: form.ceiling, buildWeeks: Number(form.buildWeeks), recoveryWeeks: Number(form.recoveryWeeks), goalCtl: Number(form.goalCtl) || null, goalReachable }) : null),
    [weeks, projection, baseline.sustainedRamp, form.ceiling, form.buildWeeks, form.recoveryWeeks, form.goalCtl, goalReachable]
  )
  const rows = useMemo(() => chartRows(projection), [projection])
  const actualByWeek = useMemo(() => Object.fromEntries(weeks.map((w) => [w.week_start, actualWeekTl(daily, w.week_start, today)])), [weeks, daily, today])

  if (!riderId) return null
  if (!enabled) return <p className={`${adminCard} text-sm ${adminMuted}`}>The macro planner is not available for your account yet.</p>

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }))
    setDirty(true)
  }
  const pickTemplate = (template) => {
    const t = TEMPLATES[template]
    set(t ? { template, buildWeeks: t.build, recoveryWeeks: t.recovery } : { template })
  }

  const generate = () => {
    setError(null)
    setNotice(null)
    if (weeks.some((w) => w.tl_overridden) && !window.confirm('Regenerating replaces your manual week changes. Continue?')) return
    const g = generatePlan({
      today, raceDate: form.raceDate, raceLength: form.raceLength, template: form.template, buildWeeks: Number(form.buildWeeks), recoveryWeeks: Number(form.recoveryWeeks),
      rampCeilingPct: Number(form.ceiling), startWeeklyTl: startTl, goalCtl: Number(form.goalCtl) || null, days: daily, baselineStatus: baseline.status,
    })
    if (g.error) return setError(g.error)
    setWeeks(g.weeks)
    setGoalReachable(g.goalReachable)
    setDirty(true)
  }

  const editWeek = (i, patch) => {
    setWeeks((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)))
    setDirty(true)
  }

  const save = async () => {
    if (!form.raceName.trim()) return setError('Give the race a name.')
    if (!weeks.length) return setError('Generate the weeks first.')
    setBusy(true)
    setError(null)
    const res = await saveMacroPlan(supabase, {
      rider_id: riderId, race_name: form.raceName.trim(), race_date: form.raceDate, race_length: form.raceLength, template: form.template,
      build_weeks: Number(form.buildWeeks), recovery_weeks: Number(form.recoveryWeeks), ramp_ceiling_pct: Number(form.ceiling),
      start_weekly_tl: startTl, baseline_source: baselineSource, goal_ctl: Number(form.goalCtl) || null, weeks,
    })
    setBusy(false)
    if (res.error) return setError(macroPlanSaveMessage(res.error))
    setNotice('Plan saved.')
    load()
  }

  const togglePublish = async () => {
    if (!plan) return
    const next = plan.status !== 'published'
    if (next && !window.confirm('Publish the plan? The athlete will see it as a read-only timeline.')) return
    setBusy(true)
    const res = await publishMacroPlan(supabase, plan.id, next)
    setBusy(false)
    if (res.error) return setError(macroPlanSaveMessage(res.error))
    setNotice(next ? 'Published. The athlete can see the timeline.' : 'Unpublished. The athlete no longer sees the plan.')
    load()
  }

  const remove = async () => {
    if (!plan || !window.confirm('Delete this plan?')) return
    setBusy(true)
    const res = await deleteMacroPlan(supabase, plan.id)
    setBusy(false)
    if (res.error) return setError(macroPlanSaveMessage(res.error))
    setPlan(null)
    setWeeks([])
    setForm({ ...defaults, startTl: baseline.status === 'history' ? String(baseline.weeklyTl) : '' })
    setNotice('Plan deleted.')
  }

  const verdict = feasibility ? VERDICT[feasibility.verdict] : null
  const race = projection?.raceDay

  return (
    <div className="space-y-4" data-testid="athlete-planner">
      <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white">
        <Icon name="trend" /> Planner{athlete ? ` · ${athlete.display_name}` : ''}
        {plan && <StatusBadge status={plan.status === 'published' ? 'approved' : 'pending'} label={plan.status === 'published' ? 'Published' : 'Draft'} />}
      </h1>
      <p className={`text-sm ${adminMuted}`}>
        Long-term plan towards one A race. A week is a target TL, a focus and a rough hard / easy / rest shape, not workouts. Load is the platform&apos;s total TL.
      </p>
      <ErrorNote>{error || fitError}</ErrorNote>
      <StatusNote>{notice}</StatusNote>

      <section className={`${adminCard} space-y-2`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Baseline</h2>
        {fitLoading ? (
          <p className={`text-sm ${adminMuted}`}>Loading history…</p>
        ) : baseline.status === 'history' ? (
          <p className={`text-sm ${adminMuted}`}>
            Last {baseline.weeks.length} weeks: about <strong>{baseline.weeklyTl} TL/week</strong>, fitness {baseline.ctl}
            {baseline.rampPerWeek !== null && <>, ramp {baseline.rampPerWeek > 0 ? '+' : ''}{baseline.rampPerWeek}/week</>}.
            {baseline.excluded > 0 && <> {baseline.excluded} week(s) excluded (sick, off or outlier).</>}
            {baseline.sustainedRamp !== null ? <> Sustained ramp about {baseline.sustainedRamp}/week.</> : <> Not enough history for a sustained ramp, using the default.</>}
          </p>
        ) : (
          <p className={`text-sm ${adminMuted}`}>Not enough recent history ({baseline.usableWeeks} usable weeks, 6 needed). Enter the athlete&apos;s current weekly TL below.</p>
        )}
      </section>

      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">A race</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Race name
            <input className={input} maxLength={80} value={form.raceName} onChange={(e) => set({ raceName: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Race date
            <input className={input} type="date" min={today} value={form.raceDate} onChange={(e) => set({ raceDate: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Race length (sets the taper)
            <select className={input} value={form.raceLength} onChange={(e) => set({ raceLength: e.target.value })}>
              {Object.entries(LENGTHS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Starting weekly TL
            <input className={input} type="number" min="1" max="5000" value={form.startTl} onChange={(e) => set({ startTl: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Mesocycle
            <select className={input} value={form.template} onChange={(e) => pickTemplate(e.target.value)}>
              {[...Object.keys(TEMPLATES), 'custom'].map((t) => <option key={t} value={t}>{t === 'custom' ? 'Custom' : `${t} (build + recovery weeks)`}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Build weeks
              <input className={input} type="number" min="1" max="8" value={form.buildWeeks} onChange={(e) => set({ template: 'custom', buildWeeks: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Recovery weeks
              <input className={input} type="number" min="1" max="3" value={form.recoveryWeeks} onChange={(e) => set({ template: 'custom', recoveryWeeks: e.target.value })} />
            </label>
          </div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Ramp ceiling (% per week)
            <input className={input} type="number" min="0" max="15" step="0.5" value={form.ceiling} onChange={(e) => set({ ceiling: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Goal fitness at the peak (optional)
            <input className={input} type="number" min="0" max="300" value={form.goalCtl} onChange={(e) => set({ goalCtl: e.target.value })} />
          </label>
        </div>
        <button type="button" className={adminBtn.primary} onClick={generate} disabled={!form.raceDate || !startTl}>
          {weeks.length ? 'Regenerate weeks' : 'Generate weeks'}
        </button>
      </section>

      {weeks.length > 0 && (
        <>
          <section className={`${adminCard} space-y-3`}>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Race day estimate</h2>
            {race ? (
              <p className="text-sm text-slate-800 dark:text-slate-200" data-testid="race-day-estimate">
                Estimated on {race.day}: fitness <strong>{race.fitness}</strong>, fatigue <strong>{race.fatigue}</strong>, form <strong>{race.form > 0 ? '+' : ''}{race.form}</strong>
                {race.status?.label ? <> ({race.status.label})</> : null}. <span className={adminMuted}>An estimate from the plan; real training will differ.</span>
              </p>
            ) : (
              <p className={`text-sm ${adminMuted}`}>No estimate available.</p>
            )}
            {verdict && (
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <StatusBadge status={verdict.tone === 'good' ? 'approved' : verdict.tone === 'warn' ? 'pending' : 'rejected'} label={verdict.label} />
                  Planned ramp {feasibility.planned ?? '-'}/week vs {feasibility.usedDefault ? 'default' : 'sustained'} {feasibility.reference}/week. {verdict.text}
                </p>
                {feasibility.goalMissed && <p className="text-sm text-amber-800 dark:text-amber-300">The goal fitness cannot be reached within the ramp ceiling.</p>}
                {feasibility.warnings.map((w, i) => <p key={i} className="text-sm text-amber-800 dark:text-amber-300">{WARNING_TEXT[w.type](w)}</p>)}
              </div>
            )}
            <ProjectionChart rows={rows} raceDate={form.raceDate} label="Planned and actual fitness to the race date" />
            <p className={`text-xs ${adminMuted}`}>Solid: actual. Dashed: forecast (real training so far, plan after today). Dotted: the plan alone. Form is fitness minus fatigue.</p>
          </section>

          <section className={`${adminCard} space-y-3`}>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Weeks</h2>
            <WeeklyTargetChart weeks={weeks} actual={actualByWeek} label="Weekly target TL" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-600 dark:text-slate-300">
                    <th className="pr-2 py-1">Week</th><th className="pr-2">Kind</th><th className="pr-2">Target TL</th><th className="pr-2">Actual</th><th className="pr-2">Focus</th><th className="pr-2">Shape (M-S)</th><th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w, i) => (
                    <tr key={w.week_start} className="border-t border-slate-200 dark:border-slate-700 align-top">
                      <td className="pr-2 py-2 whitespace-nowrap text-slate-900 dark:text-white">{w.week_start}</td>
                      <td className="pr-2 py-1">
                        <select aria-label={`Kind ${w.week_start}`} className={`${input} min-w-[7rem]`} value={w.kind} onChange={(e) => editWeek(i, { kind: e.target.value })}>
                          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="pr-2 py-1">
                        <input aria-label={`Target TL ${w.week_start}`} className={`${input} w-24`} type="number" min="0" max="5000" value={w.target_tl} onChange={(e) => editWeek(i, { target_tl: Math.max(0, Number(e.target.value) || 0), tl_overridden: true })} />
                      </td>
                      <td className="pr-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">{actualByWeek[w.week_start] ?? '-'}</td>
                      <td className="pr-2 py-1"><input aria-label={`Focus ${w.week_start}`} className={`${input} min-w-[8rem]`} maxLength={40} value={w.focus || ''} onChange={(e) => editWeek(i, { focus: e.target.value })} /></td>
                      <td className="pr-2 py-1">
                        <div className="flex gap-1">
                          {w.day_shape.split('').map((c, d) => (
                            <button
                              key={d}
                              type="button"
                              title={{ H: 'Hard', E: 'Easy', R: 'Rest' }[c]}
                              aria-label={`${DAY_LETTERS[d]} ${{ H: 'hard', E: 'easy', R: 'rest' }[c]}, ${w.week_start}`}
                              className={`h-9 w-9 rounded-lg border text-xs font-black ${SHAPE_CLASS[c]}`}
                              onClick={() => editWeek(i, { day_shape: w.day_shape.slice(0, d) + SHAPE_NEXT[c] + w.day_shape.slice(d + 1) })}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="py-1"><input aria-label={`Note ${w.week_start}`} className={`${input} min-w-[10rem]`} maxLength={500} value={w.note || ''} onChange={(e) => editWeek(i, { note: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`text-xs ${adminMuted}`}>H hard, E easy, R rest: tap a day to change it. Changing a target marks the week as a manual override.</p>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={adminBtn.primary} onClick={save} disabled={busy}>{dirty || !plan ? 'Save plan' : 'Saved'}</button>
            {plan && (
              <button type="button" className={plan.status === 'published' ? adminBtn.secondary : adminBtn.success} onClick={togglePublish} disabled={busy || dirty}>
                {plan.status === 'published' ? 'Unpublish' : 'Publish to athlete'}
              </button>
            )}
            {plan && <button type="button" className={adminBtn.danger} onClick={remove} disabled={busy}>Delete plan</button>}
          </div>
          {plan && dirty && <p className={`text-xs ${adminMuted}`}>Save your changes before publishing.</p>}
        </>
      )}
    </div>
  )
}
