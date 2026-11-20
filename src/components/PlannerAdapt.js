'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ErrorNote, StatusNote, StatusBadge, adminBtn, adminCard, adminInput, adminMuted } from './admin/AdminUi'
import { computeProfile, mergeBests } from '../lib/labPowerProfile'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import {
  saveDisruption, deleteDisruption, setMinorRaces, setAvailability, setReview, setShareReasoning, applyPlanOption, macroPlanSaveMessage,
} from '../lib/macroPlannerFlag'
import {
  suggestDisruptionOptions, suggestAvailabilityOption, suggestAdherenceOption, weekAdherence, adherenceReview, focusHint,
} from '../lib/macroPlannerAdapt'
import { weekStartOf } from '../lib/macroPlanner'
import { selectableRaces, raceOptionLabel, fetchUpcomingCalendarRaces, addRaceToCalendarHref } from '../lib/macroPlannerCalendar'

const input = `${adminInput} !py-2`
const h2 = 'text-lg font-black text-slate-900 dark:text-white'
const label = 'text-xs font-semibold text-slate-600 dark:text-slate-300'
const LIGHT = { green: 'approved', amber: 'pending', red: 'rejected', skip: 'pending' }
const LIGHT_TEXT = { green: 'On target', amber: 'Off target', red: 'Well off target', skip: 'Not scored' }
const REASONS = { travel: 'Travel', holiday: 'Holiday', work: 'Work crunch', other: 'Other' }
const SEVERITY = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' }
const VERDICT_LABEL = { ok: 'Realistic', stretch: 'Stretch', unrealistic: 'Unrealistic' }
const VERDICT_STATUS = { ok: 'approved', stretch: 'pending', unrealistic: 'rejected' }
const SOURCE_LABEL = { disruption: 'Disruption', availability: 'Availability', adherence: 'Adherence', manual: 'Manual' }

const fmtForm = (r) => (r ? `${r.form > 0 ? '+' : ''}${r.form}` : '-')

function OptionCard({ option, current, onApply, disabled }) {
  const race = option.raceDay
  const cur = current?.raceDay
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-1 dark:border-slate-700" data-testid={`option-${option.key}`}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
        {option.label}
        {option.feasibility && <StatusBadge status={VERDICT_STATUS[option.feasibility.verdict]} label={VERDICT_LABEL[option.feasibility.verdict]} />}
      </p>
      <p className={`text-sm ${adminMuted}`}>{option.description}</p>
      <p className="text-sm text-slate-800 dark:text-slate-200">
        Estimated race-day form <strong>{fmtForm(race)}</strong> (fitness {race?.fitness ?? '-'}), planned peak fitness {option.peakCtl}
        {cur && <span className={adminMuted}> · unchanged plan: form {fmtForm(cur)}, fitness {cur.fitness}</span>}
        {option.goalCtl ? <> · goal fitness {option.goalCtl}</> : null}
        {option.feasibility?.goalMissed && <span className="text-amber-800 dark:text-amber-300"> · the goal is not reached</span>}
      </p>
      <button type="button" className={adminBtn.primary} onClick={() => onApply(option)} disabled={disabled}>Apply this option</button>
    </div>
  )
}

// Everything that adapts a saved plan. All options are suggestions: nothing changes until the coach applies one,
// and every applied option is written to the audit trail (macro_plan_apply).
export default function PlannerAdapt({ plan, weeks, daily, today, baseline, riderId, dirty, reload }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState(null)
  const [dForm, setDForm] = useState({ kind: 'illness', severity: 'moderate', start_date: today, end_date: '', note: '' })
  const [raceForm, setRaceForm] = useState({ race_id: '', priority: 'B' })
  const [calRaces, setCalRaces] = useState([])
  const [avForm, setAvForm] = useState({ week_start: weekStartOf(today), availability_pct: 50, reason: 'travel', note: '' })
  const [share, setShare] = useState(!!plan.share_reasoning)
  const [rationale, setRationale] = useState(plan.plan_rationale || '')
  const [phenotype, setPhenotype] = useState(null)

  const disruptions = useMemo(() => plan.disruptions || [], [plan.disruptions])
  const races = useMemo(() => plan.races || [], [plan.races])
  const activeRaces = useMemo(() => races.filter((r) => !r.missing), [races])
  const availability = useMemo(() => plan.availability || [], [plan.availability])
  const reviews = useMemo(() => plan.reviews || [], [plan.reviews])
  useEffect(() => {
    let live = true
    fetchUpcomingCalendarRaces(supabase, riderId, today).then((res) => { if (live && !res.error) setCalRaces(res.data) })
    return () => { live = false }
  }, [riderId, today, plan.races])
  const raceChoices = useMemo(
    () => selectableRaces(calRaces, { today, usedIds: [plan.race_id, ...races.map((r) => r.race_id)], before: plan.race_date }),
    [calRaces, today, plan.race_id, plan.race_date, races]
  )
  const goalCtl = plan.goal_ctl ? Number(plan.goal_ctl) : null

  const ctx = useMemo(() => ({
    weeks, today, raceDate: plan.race_date, raceLength: plan.race_length, buildWeeks: plan.build_weeks, recoveryWeeks: plan.recovery_weeks,
    rampCeilingPct: Number(plan.ramp_ceiling_pct), goalCtl, days: daily, startWeeklyTl: Number(plan.start_weekly_tl), baselineStatus: baseline.status,
    sustained: baseline.sustainedRamp, races: activeRaces,
  }), [weeks, today, plan, goalCtl, daily, baseline, activeRaces])

  const rows = useMemo(() => weekAdherence({ weeks, days: daily, today, disruptions }), [weeks, daily, today, disruptions])
  const review = useMemo(() => adherenceReview(rows), [rows])
  const reviewRow = review.propose ? reviews.find((r) => r.week_start === review.week_start) : null
  const openReview = reviews.find((r) => r.status === 'open')

  // Propose a review once per drifting week; a dismissed or finished week is never reopened.
  useEffect(() => {
    if (!review.propose || reviewRow) return
    setReview(supabase, plan.id, review.week_start, review.reason, 'open').then((r) => { if (!r.error) reload() })
  }, [review.propose, review.week_start, review.reason, reviewRow, plan.id, reload])

  useEffect(() => {
    let live = true
    ;(async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString()
      const [acts, wh] = await Promise.all([
        supabase.from('activities').select('curves_data').eq('user_id', riderId).gte('activity_date', since).limit(500),
        fetchWeightHistory(supabase, riderId),
      ])
      if (!live || acts.error) return
      const w = weightAt(wh.history, today)
      if (!w) return
      const p = computeProfile({ bests: mergeBests((acts.data || []).map((a) => a.curves_data?.Power || null)), weightKg: w, age: null, sex: 'male' })
      setPhenotype(p.phenotype?.type || null)
    })()
    return () => { live = false }
  }, [riderId, today])
  const hint = focusHint(phenotype, plan.race_length)

  const run = async (fn, okText) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await fn()
    setBusy(false)
    if (res.error) {
      setError(macroPlanSaveMessage(res.error))
      return false
    }
    if (okText) setNotice(okText)
    reload()
    return true
  }

  const apply = async (source, option, disruptionId) => {
    if (!window.confirm(`Apply "${option.label}"? This replaces the weekly targets and is recorded in the audit trail.`)) return
    const payload = {
      source, option: option.key, summary: option.description.slice(0, 300),
      weeks: option.weeks.map((w) => ({ week_start: w.week_start, kind: w.kind, target_tl: w.target_tl, focus: w.focus || '', note: w.note || '', day_shape: w.day_shape, tl_overridden: !!w.tl_overridden, rationale: w.rationale || '' })),
      ...(option.key === 'lower_goal' ? { goal_ctl: option.goalCtl } : {}),
      ...(disruptionId ? { disruption_id: disruptionId } : {}),
    }
    if (await run(() => applyPlanOption(supabase, plan.id, payload), 'Option applied and recorded.')) setOptions(null)
  }

  const suggestFor = (d) => {
    const res = suggestDisruptionOptions({ ...ctx, disruption: d, disruptions })
    setOptions({ source: 'disruption', disruptionId: d.id, title: `Replan options after the ${d.kind} from ${d.start_date}`, ...res })
  }
  const suggestAvail = () => {
    const o = suggestAvailabilityOption({ ...ctx, availability })
    setOptions({ source: 'availability', title: 'Adapt to availability', current: o?.current, options: o ? [o] : [], empty: 'No upcoming week has reduced availability.' })
  }
  const suggestAdherence = () => {
    const o = suggestAdherenceOption({ ...ctx, rows })
    setOptions({ source: 'adherence', title: 'Review: adherence', current: o?.current, options: o ? [o] : [], empty: 'Not enough recent load to rebase on.' })
  }

  const saveD = () => {
    const d = { kind: dForm.kind, severity: dForm.severity, start_date: dForm.start_date, end_date: dForm.end_date || null, note: dForm.note }
    run(() => saveDisruption(supabase, plan.id, d), 'Disruption logged. Nothing in the plan has changed.')
  }
  const saveRaces = (next) => run(() => setMinorRaces(supabase, plan.id, next.filter((r) => r.race_id).map(({ race_id, priority }) => ({ race_id, priority }))), 'Races saved. They are applied when you regenerate the weeks or apply an option.')
  const saveAv = (next) => run(() => setAvailability(supabase, plan.id, next.map(({ week_start, availability_pct, reason, note }) => ({ week_start, availability_pct, reason, note: note || '' }))), 'Availability saved. Nothing in the plan has changed yet.')

  const scored = rows.filter((r) => r.light !== 'skip')

  return (
    <div className="space-y-4" data-testid="planner-adapt">
      <ErrorNote>{error}</ErrorNote>
      <StatusNote>{notice}</StatusNote>
      {dirty && <p className={`text-xs ${adminMuted}`}>Save the plan before using the options below: they are computed from the saved weeks.</p>}

      {openReview && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2 dark:border-amber-700 dark:bg-amber-950/30" data-testid="review-banner">
          <h2 className={h2}>Review suggested</h2>
          <p className="text-sm text-slate-800 dark:text-slate-200">{openReview.reason} (week of {openReview.week_start})</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={adminBtn.primary} onClick={suggestAdherence} disabled={dirty || busy}>See options</button>
            <button type="button" className={adminBtn.secondary} onClick={() => run(() => setReview(supabase, plan.id, openReview.week_start, openReview.reason, 'dismissed'))} disabled={busy}>Dismiss</button>
            <button type="button" className={adminBtn.secondary} onClick={() => run(() => setReview(supabase, plan.id, openReview.week_start, openReview.reason, 'done'))} disabled={busy}>Mark as done</button>
          </div>
        </section>
      )}

      {options && (
        <section className={`${adminCard} space-y-3`} data-testid="options-panel">
          <h2 className={h2}>{options.title}</h2>
          {options.options.length === 0 && <p className={`text-sm ${adminMuted}`}>{options.empty || 'No options for this case.'}</p>}
          {options.preTl > 0 && <p className={`text-xs ${adminMuted}`}>Pre-break load about {options.preTl} TL/week ({options.preSource === 'history' ? 'from recent history' : 'from the plan'}); assumed break {options.breakDays} day(s){options.ongoing ? ', ongoing (assumed to end today)' : ''}.</p>}
          {options.options.map((o) => <OptionCard key={o.key} option={o} current={options.current} disabled={busy || dirty} onApply={(x) => apply(options.source, x, options.disruptionId)} />)}
          <p className={`text-xs ${adminMuted}`}>Suggestions only. Estimates, not predictions; nothing changes until you apply one.</p>
          <button type="button" className={adminBtn.secondary} onClick={() => setOptions(null)}>Close</button>
        </section>
      )}

      <section className={`${adminCard} space-y-3`} data-testid="adherence">
        <h2 className={h2}>Adherence</h2>
        {scored.length === 0 ? (
          <p className={`text-sm ${adminMuted}`}>No completed week to score yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-600 dark:text-slate-300"><th className="pr-2 py-1">Week</th><th className="pr-2">Planned TL</th><th className="pr-2">Actual TL</th><th className="pr-2">%</th><th>Status</th></tr></thead>
              <tbody>
                {rows.slice(-8).map((r) => (
                  <tr key={r.week_start} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="pr-2 py-1 whitespace-nowrap text-slate-900 dark:text-white">{r.week_start}</td>
                    <td className="pr-2 tabular-nums">{r.target}</td>
                    <td className="pr-2 tabular-nums">{r.actual}</td>
                    <td className="pr-2 tabular-nums">{r.ratio === null ? '-' : Math.round(r.ratio * 100)}</td>
                    <td><StatusBadge status={LIGHT[r.light]} label={r.reason === 'disruption' ? 'Disruption' : LIGHT_TEXT[r.light]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={`text-xs ${adminMuted}`}>Green 85-115 % of target, amber 70-130 %, otherwise red. Weeks with a logged disruption are not scored. A review is proposed when two weeks in a row are red or three in a row are off target in the same direction.</p>
      </section>

      <section className={`${adminCard} space-y-3`} data-testid="disruptions">
        <h2 className={h2}>Illness and injury</h2>
        <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="medical-notice">Not medical advice. The return-to-training ramp is a planning estimate; follow the athlete&apos;s clinician for any health decision.</p>
        {disruptions.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
            <span><strong>{d.kind === 'illness' ? 'Illness' : 'Injury'}</strong> ({SEVERITY[d.severity]}) {d.start_date} to {d.end_date || 'ongoing'}{d.note ? ` · ${d.note}` : ''}</span>
            <button type="button" className={adminBtn.secondary} onClick={() => suggestFor(d)} disabled={dirty || busy}>Suggest replan</button>
            <button type="button" className={adminBtn.danger} onClick={() => window.confirm('Delete this disruption?') && run(() => deleteDisruption(supabase, plan.id, d.id))} disabled={busy}>Delete</button>
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>Type
            <select className={input} value={dForm.kind} onChange={(e) => setDForm({ ...dForm, kind: e.target.value })}><option value="illness">Illness</option><option value="injury">Injury</option></select>
          </label>
          <label className={label}>Severity
            <select className={input} value={dForm.severity} onChange={(e) => setDForm({ ...dForm, severity: e.target.value })}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className={label}>Start date
            <input className={input} type="date" value={dForm.start_date} onChange={(e) => setDForm({ ...dForm, start_date: e.target.value })} />
          </label>
          <label className={label}>End date (optional)
            <input className={input} type="date" min={dForm.start_date} value={dForm.end_date} onChange={(e) => setDForm({ ...dForm, end_date: e.target.value })} />
          </label>
          <label className={`${label} sm:col-span-2`}>Note
            <input className={input} maxLength={300} value={dForm.note} onChange={(e) => setDForm({ ...dForm, note: e.target.value })} />
          </label>
        </div>
        <button type="button" className={adminBtn.primary} onClick={saveD} disabled={busy || !dForm.start_date}>Log disruption</button>
        <p className={`text-xs ${adminMuted}`}>Logging does not change the plan. Weeks with a disruption are left out of the baseline.</p>
      </section>

      <section className={`${adminCard} space-y-3`} data-testid="minor-races">
        <h2 className={h2}>B and C races</h2>
        <p className={`text-sm ${adminMuted}`}>B race: mini-taper in race week and an easier week after. C race: train through. Both must be before the A race.</p>
        {races.map((r) => (
          <div key={r.id || `${r.name}${r.race_date}`} className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200" data-testid={r.missing ? 'minor-race-missing' : 'minor-race'}>
            <span><strong>{r.priority}</strong> {r.name} · {r.race_date}</span>
            {r.missing && <span className="font-semibold text-amber-700 dark:text-amber-300">Deleted from the athlete&apos;s calendar, no longer used in the plan</span>}
            <button type="button" className={adminBtn.danger} onClick={() => saveRaces(races.filter((x) => x !== r))} disabled={busy}>Remove</button>
          </div>
        ))}
        {!raceChoices.length ? (
          <p className="text-sm text-slate-800 dark:text-slate-200" data-testid="no-minor-calendar-race">
            No other upcoming race before the A race in the athlete&apos;s calendar. <Link className="font-semibold underline" href={addRaceToCalendarHref(riderId)}>Add it to the athlete&apos;s calendar first</Link>, then select it here.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Calendar race
              <select className={input} value={raceForm.race_id} onChange={(e) => setRaceForm({ ...raceForm, race_id: e.target.value })}>
                <option value="">Select a race…</option>
                {raceChoices.map((r) => <option key={r.id} value={r.id}>{raceOptionLabel(r)}</option>)}
              </select>
            </label>
            <label className={label}>Role in the plan<select className={input} value={raceForm.priority} onChange={(e) => setRaceForm({ ...raceForm, priority: e.target.value })}><option value="B">B (mini-taper)</option><option value="C">C (train through)</option></select></label>
          </div>
        )}
        <button type="button" className={adminBtn.primary} disabled={busy || !raceForm.race_id || races.some((r) => r.missing)} onClick={async () => { if (await saveRaces([...races, { ...raceForm }])) setRaceForm({ ...raceForm, race_id: '' }) }}>Add race</button>
        {races.some((r) => r.missing) && <p className={`text-xs ${adminMuted}`}>Remove the deleted race first.</p>}
        <p className={`text-xs ${adminMuted}`}>Races are applied whenever the weeks are regenerated or an option is applied; the weeks table is not changed by adding a race.</p>
      </section>

      <section className={`${adminCard} space-y-3`} data-testid="availability">
        <h2 className={h2}>Availability</h2>
        <p className={`text-sm ${adminMuted}`}>Mark weeks with reduced availability (travel, holiday, work). The plan then suggests lower targets for those weeks.</p>
        {availability.map((a) => (
          <div key={a.week_start} className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
            <span>Week of {a.week_start}: <strong>{a.availability_pct} %</strong> · {REASONS[a.reason] || a.reason}{a.note ? ` · ${a.note}` : ''}</span>
            <button type="button" className={adminBtn.danger} onClick={() => saveAv(availability.filter((x) => x.week_start !== a.week_start))} disabled={busy}>Remove</button>
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className={label}>Week of (Monday)<input className={input} type="date" value={avForm.week_start} onChange={(e) => setAvForm({ ...avForm, week_start: e.target.value ? weekStartOf(e.target.value) : '' })} /></label>
          <label className={label}>Available (%)<input className={input} type="number" min="0" max="100" step="5" value={avForm.availability_pct} onChange={(e) => setAvForm({ ...avForm, availability_pct: Number(e.target.value) })} /></label>
          <label className={label}>Reason<select className={input} value={avForm.reason} onChange={(e) => setAvForm({ ...avForm, reason: e.target.value })}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={label}>Note<input className={input} maxLength={200} value={avForm.note} onChange={(e) => setAvForm({ ...avForm, note: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={adminBtn.primary} disabled={busy || !avForm.week_start} onClick={() => saveAv([...availability.filter((x) => x.week_start !== avForm.week_start), avForm])}>Mark week</button>
          <button type="button" className={adminBtn.secondary} disabled={busy || dirty || availability.length === 0} onClick={suggestAvail}>Suggest plan changes</button>
        </div>
      </section>

      <section className={`${adminCard} space-y-3`} data-testid="share-reasoning">
        <h2 className={h2}>Share the reasoning</h2>
        <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Show the plan rationale and per-week reasoning on the athlete&apos;s plan page
        </label>
        <label className={label}>Plan rationale
          <textarea className={input} rows={3} maxLength={1000} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </label>
        <button type="button" className={adminBtn.primary} disabled={busy} onClick={() => run(() => setShareReasoning(supabase, plan.id, share, rationale), 'Saved.')}>Save sharing</button>
        <p className={`text-xs ${adminMuted}`}>Off by default. Per-week reasoning is edited in the weeks table. Disruptions, availability and the audit trail are never shown to the athlete.</p>
      </section>

      {hint && (
        <section className={`${adminCard} space-y-1`} data-testid="lab-hint">
          <h2 className={h2}>Lab hint: {hint.label}</h2>
          <p className="text-sm text-slate-800 dark:text-slate-200">{hint.text}</p>
          <p className={`text-xs ${adminMuted}`}>From the athlete&apos;s power profile in the Lab (last 90 days). A hint for the focus labels only; nothing is changed automatically.</p>
        </section>
      )}

      <section className={`${adminCard} space-y-2`} data-testid="audit">
        <h2 className={h2}>Applied changes</h2>
        {(plan.audit || []).length === 0 ? <p className={`text-sm ${adminMuted}`}>Nothing has been applied yet.</p> : (plan.audit || []).map((a) => (
          <p key={a.id} className="text-sm text-slate-800 dark:text-slate-200">
            <span className={adminMuted}>{String(a.created_at).slice(0, 10)}</span> · <strong>{SOURCE_LABEL[a.source] || a.source}</strong>: {a.summary}
          </p>
        ))}
      </section>
    </div>
  )
}
