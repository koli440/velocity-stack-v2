'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage } from '../lib/labRuns'
import { computeLactateResult, ltEntryFromResult, normalizeSteps } from '../lib/lactateStepTest'
import { fetchLtHistory, saveLtEntry, validateLtEntry } from '../lib/lactateThresholds'
import { LACTATE_INSTRUCTION, normalizePlan, planToRows, resolvePlan } from '../lib/lactatePlan'
import { fetchFtpHistory, ftpAt } from '../lib/ftpHistory'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const primary = adminBtn.primary
const quiet = adminBtn.secondary
const card = adminCard
const input = adminInput
const today = () => new Date().toISOString().slice(0, 10)
const emptyRows = () => Array.from({ length: 6 }, () => ({ power: '', hr: '', lactate: '' }))

export function LactateChart({ steps, result }) {
  const W = 320
  const H = 160
  const pad = 28
  const maxP = Math.max(...steps.map((s) => s.power))
  const minP = Math.min(...steps.map((s) => s.power))
  const maxL = Math.max(4.5, ...steps.map((s) => s.lactate))
  const x = (p) => pad + ((p - minP) / (maxP - minP || 1)) * (W - pad * 2)
  const y = (l) => H - pad - (l / maxL) * (H - pad * 2)
  const marks = [['LT1', result.lt1, '#16a34a'], ['LT2', result.lt2, '#dc2626']].filter((m) => m[1])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md text-slate-600 dark:text-slate-300" role="img" aria-label="Lactate curve" data-testid="lactate-chart">
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={steps.map((s) => `${x(s.power)},${y(s.lactate)}`).join(' ')} />
      {steps.map((s) => <circle key={s.power} cx={x(s.power)} cy={y(s.lactate)} r="3" fill="#6366f1" />)}
      {marks.map(([label, m, color]) => (
        <g key={label}>
          <line x1={x(m.power)} x2={x(m.power)} y1={pad / 2} y2={H - pad} stroke={color} strokeDasharray="4 3" />
          <text x={x(m.power)} y={pad / 2 - 2} fontSize="9" textAnchor="middle" fill={color}>{label} {m.power}W</text>
        </g>
      ))}
      <text x={pad} y={H - 8} fontSize="9" fill="currentColor">{minP} W</text>
      <text x={W - pad} y={H - 8} fontSize="9" textAnchor="end" fill="currentColor">{maxP} W</text>
      <text x={4} y={pad} fontSize="9" fill="currentColor">mmol/L</text>
    </svg>
  )
}

function Thresholds({ result }) {
  const row = (label, v) => (
    <li key={label}>{label}: {v ? `${v.power} W${v.hr != null ? ` · ${v.hr} bpm` : ''}` : 'not reached'}</li>
  )
  return (
    <ul className="text-sm text-slate-800 dark:text-slate-200 space-y-0.5" data-testid="lactate-thresholds">
      {row('LT1 (baseline + 0.5)', result.lt1)}
      {row(`LT2 (${result.lt2Method === 'obla4' ? 'OBLA 4' : 'Dmax'})`, result.lt2)}
      {row('OBLA 2 mmol', result.obla2)}
      {row('OBLA 4 mmol', result.obla4)}
    </ul>
  )
}

// Lactate step test: enter power/HR/lactate per step, compute thresholds, save privately and optionally
// apply LT1/LT2 to the athlete's lactate threshold history (zones follow it).
export default function LabLactateTest({ athleteId, viewerId }) {
  const [tests, setTests] = useState([])
  const [rows, setRows] = useState(emptyRows)
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [planInfo, setPlanInfo] = useState(() => resolvePlan(null))
  const [ftp, setFtp] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lab_lactate_list', { p_athlete: athleteId })
    if (error) setMsg({ error: labErrorMessage(error) })
    else setTests(data || [])
  }, [athleteId])
  useEffect(() => { load() }, [load])

  const loadPlan = useCallback(async () => {
    const [{ data }, { history }] = await Promise.all([
      supabase.rpc('lab_lactate_plan_get', { p_athlete: athleteId }),
      fetchFtpHistory(supabase, athleteId),
    ])
    const info = resolvePlan(data)
    const f = ftpAt(history, today())
    setPlanInfo(info)
    setFtp(f)
    setRows(planToRows(info.plan, f))
  }, [athleteId])
  useEffect(() => { loadPlan() }, [loadPlan])

  const savePlan = async () => {
    const n = normalizePlan(editing)
    if (n.error) return setMsg({ error: n.error })
    setBusy(true)
    const { error } = await supabase.rpc('lab_lactate_plan_save', {
      p_athlete: athleteId, p_instruction: '', p_step_minutes: n.plan.step_minutes, p_steps: n.plan.steps,
    })
    setBusy(false)
    if (error) return setMsg({ error: labErrorMessage(error) })
    setEditing(null)
    setMsg({ ok: 'Steps saved' })
    loadPlan()
  }

  const resetPlan = async () => {
    if (!window.confirm('Go back to the default steps?')) return
    const { error } = await supabase.rpc('lab_lactate_plan_reset', { p_athlete: athleteId })
    if (error) return setMsg({ error: labErrorMessage(error) })
    setEditing(null)
    loadPlan()
  }

  const setCell = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const calculate = () => {
    const n = normalizeSteps(rows)
    if (n.error) { setPreview(null); setMsg({ error: n.error }); return }
    setMsg(null)
    setPreview({ steps: n.steps, result: computeLactateResult(n.steps) })
  }

  const save = async () => {
    if (!preview) return
    setBusy(true)
    const { error } = await supabase.rpc('lab_lactate_save', {
      p_athlete: athleteId, p_date: date, p_steps: preview.steps, p_result: preview.result,
    })
    setBusy(false)
    if (error) return setMsg({ error: labErrorMessage(error) })
    setMsg({ ok: 'Saved' })
    setPreview(null)
    setRows(planToRows(planInfo.plan, ftp))
    load()
  }

  const apply = async (test) => {
    const entry = ltEntryFromResult(test.result, test.test_date)
    const v = entry ? validateLtEntry(entry) : { error: 'No usable thresholds in this test' }
    if (v.error) return setMsg({ error: v.error })
    const { history, error: hErr } = await fetchLtHistory(supabase, athleteId)
    if (hErr) return setMsg({ error: 'Could not load threshold history' })
    if (history.some((h) => h.effective_from === v.entry.effective_from)
        && !window.confirm(`Replace the lactate thresholds already set for ${v.entry.effective_from}?`)) return
    setBusy(true)
    const { error } = await saveLtEntry(supabase, { userId: athleteId, entry: v.entry })
    setBusy(false)
    setMsg(error ? { error: error.message || 'Could not apply' } : { ok: `LT1/LT2 applied from ${v.entry.effective_from}` })
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this test?')) return
    const { error } = await supabase.rpc('lab_lactate_delete', { p_id: id })
    if (error) setMsg({ error: labErrorMessage(error) })
    else load()
  }

  return (
    <div className="space-y-4" data-testid="lab-lactate">
      <p className="text-sm text-slate-600 dark:text-slate-300">Private: visible to the athlete and their active coach only.</p>
      <section className={card} data-testid="lactate-plan">
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">How to do the test</h2>
        {editing ? (
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 sm:max-w-xs"><span>Step length (minutes)</span>
              <input type="number" className={input} value={editing.step_minutes} onChange={(e) => setEditing({ ...editing, step_minutes: e.target.value })} /></label>
            <div className="space-y-1">
              {editing.steps.map((st, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-14 text-sm font-bold text-slate-800 dark:text-slate-200">Step {i + 1}</span>
                  <input type="number" aria-label={`% of FTP step ${i + 1}`} className={`${input} max-w-[7rem]`} value={st.pct} onChange={(e) => setEditing({ ...editing, steps: editing.steps.map((x, j) => (j === i ? { pct: e.target.value } : x)) })} />
                  <span className="text-sm text-slate-700 dark:text-slate-300">% FTP</span>
                  <button className={adminBtn.danger} onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={quiet} onClick={() => setEditing({ ...editing, steps: [...editing.steps, { pct: '' }].slice(0, 20) })}>Add step</button>
              <button className={primary} disabled={busy} onClick={savePlan}>Save steps</button>
              <button className={quiet} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line" data-testid="lactate-instruction">{LACTATE_INSTRUCTION}</p>
            <p className="text-sm text-slate-800 dark:text-slate-200" data-testid="lactate-prepared-steps">
              {planInfo.plan.steps.length} steps of {planInfo.plan.step_minutes} min: {planInfo.plan.steps.map((st) => (ftp > 0 ? `${Math.round((ftp * st.pct) / 100)} W` : `${st.pct}% FTP`)).join(', ')}
              {ftp > 0 ? ` (from FTP ${ftp} W)` : ' (set your FTP to see watts)'}
            </p>
            {planInfo.fromCoach && <p className="text-xs text-slate-600 dark:text-slate-300">Prepared by your coach.</p>}
            {planInfo.editable && (
              <div className="flex flex-wrap gap-2">
                <button className={quiet} onClick={() => setEditing({ step_minutes: planInfo.plan.step_minutes, steps: planInfo.plan.steps.map((st) => ({ pct: st.pct })) })}>Edit steps</button>
                {planInfo.custom && <button className={quiet} onClick={resetPlan}>Reset to default</button>}
              </div>
            )}
          </div>
        )}
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">New step test</h2>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 sm:max-w-xs"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
        <div className="overflow-x-auto"><table className="mt-3 text-sm w-full max-w-lg">
          <thead><tr className="text-left text-slate-700 dark:text-slate-200"><th>Step</th><th>Power (W)</th><th>HR (bpm)</th><th>Lactate (mmol/L)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 font-bold text-slate-800 dark:text-slate-200">{i + 1}</td>
                {['power', 'hr', 'lactate'].map((k) => (
                  <td key={k} className="pr-2 py-1"><input inputMode="decimal" aria-label={`${k} step ${i + 1}`} value={r[k]} onChange={(e) => setCell(i, k, e.target.value)} className={input} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={quiet} onClick={() => setRows((rs) => [...rs, { power: '', hr: '', lactate: '' }].slice(0, 20))}>Add step</button>
          <button className={primary} onClick={calculate}>Calculate</button>
        </div>
        {preview && (
          <div className="mt-3 space-y-2">
            <LactateChart steps={preview.steps} result={preview.result} />
            <Thresholds result={preview.result} />
            <button className={primary} disabled={busy} onClick={save}>Save test</button>
          </div>
        )}
        {msg?.error && <ErrorNote>{msg.error}</ErrorNote>}
        {msg?.ok && <StatusNote>{msg.ok}</StatusNote>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">History</h2>
        {tests.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No lactate tests yet.</p>}
        <ul className="space-y-4">
          {tests.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 dark:border-slate-600 p-3" data-testid="lactate-test">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t.test_date}</p>
              <LactateChart steps={t.steps} result={t.result} />
              <Thresholds result={t.result} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={primary} disabled={busy} onClick={() => apply(t)}>Apply LT1/LT2</button>
                <button className={adminBtn.danger} onClick={() => remove(t.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
