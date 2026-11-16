'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage } from '../lib/labRuns'
import { computeLactateResult, ltEntryFromResult, normalizeSteps } from '../lib/lactateStepTest'
import { fetchLtHistory, saveLtEntry, validateLtEntry } from '../lib/lactateThresholds'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'
const primary = `${btn} bg-indigo-600 border-indigo-600 text-white`
const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300`
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4'
const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm'
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label="Lactate curve" data-testid="lactate-chart">
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={steps.map((s) => `${x(s.power)},${y(s.lactate)}`).join(' ')} />
      {steps.map((s) => <circle key={s.power} cx={x(s.power)} cy={y(s.lactate)} r="3" fill="#6366f1" />)}
      {marks.map(([label, m, color]) => (
        <g key={label}>
          <line x1={x(m.power)} x2={x(m.power)} y1={pad / 2} y2={H - pad} stroke={color} strokeDasharray="4 3" />
          <text x={x(m.power)} y={pad / 2 - 2} fontSize="9" textAnchor="middle" fill={color}>{label} {m.power}W</text>
        </g>
      ))}
      <text x={pad} y={H - 8} fontSize="9" fill="#64748b">{minP} W</text>
      <text x={W - pad} y={H - 8} fontSize="9" textAnchor="end" fill="#64748b">{maxP} W</text>
      <text x={4} y={pad} fontSize="9" fill="#64748b">mmol/L</text>
    </svg>
  )
}

function Thresholds({ result }) {
  const row = (label, v) => (
    <li key={label}>{label}: {v ? `${v.power} W${v.hr != null ? ` · ${v.hr} bpm` : ''}` : 'not reached'}</li>
  )
  return (
    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5" data-testid="lactate-thresholds">
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

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lab_lactate_list', { p_athlete: athleteId })
    if (error) setMsg({ error: labErrorMessage(error) })
    else setTests(data || [])
  }, [athleteId])
  useEffect(() => { load() }, [load])

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
    setRows(emptyRows())
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
      <p className="text-xs text-slate-500">Private: visible to the athlete and their active coach only.</p>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">New step test</h2>
        <label className="text-xs text-slate-500">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} w-40 inline-block ml-2`} /></label>
        <table className="mt-3 text-xs w-full max-w-md">
          <thead><tr className="text-left text-slate-500"><th>Step</th><th>Power (W)</th><th>HR (bpm)</th><th>Lactate (mmol/L)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="pr-2">{i + 1}</td>
                {['power', 'hr', 'lactate'].map((k) => (
                  <td key={k} className="pr-2 py-0.5"><input inputMode="decimal" aria-label={`${k} step ${i + 1}`} value={r[k]} onChange={(e) => setCell(i, k, e.target.value)} className={input} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-2">
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
        {msg?.error && <p className="mt-2 text-xs text-red-600" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="mt-2 text-xs text-emerald-600">{msg.ok}</p>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">History</h2>
        {tests.length === 0 && <p className="text-xs text-slate-500">No lactate tests yet.</p>}
        <ul className="space-y-4">
          {tests.map((t) => (
            <li key={t.id} className="border-t border-slate-100 dark:border-slate-800 pt-3" data-testid="lactate-test">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.test_date}</p>
              <LactateChart steps={t.steps} result={t.result} />
              <Thresholds result={t.result} />
              <div className="mt-2 flex gap-2">
                <button className={primary} disabled={busy} onClick={() => apply(t)}>Apply LT1/LT2</button>
                <button className={quiet} onClick={() => remove(t.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
