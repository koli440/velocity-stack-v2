'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage } from '../lib/labRuns'
import {
  CADENCE_INSTRUCTION, DEFAULT_CADENCES, FIT_FIELDS, NOT_MEDICAL_NOTICE, PEDALLING_FIELDS, buildEntry, cadenceProfile,
  compareFastedFed, fitDeltas, parseGlucoseCsv, parseReadingLines, pedallingTrend, summarizeEntry, summarizeFueling,
} from '../lib/labProtocolEntries'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const primary = adminBtn.primary
const quiet = adminBtn.secondary
const card = adminCard
const input = adminInput
const today = () => new Date().toISOString().slice(0, 10)
const h2 = 'text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2'
const muted = 'text-sm text-slate-600 dark:text-slate-300'

function Field({ label, value, onChange, ...rest }) {
  return (
    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">{label}
      <input inputMode="decimal" value={value || ''} onChange={(e) => onChange(e.target.value)} className={input} {...rest} />
    </label>
  )
}

// Shared list/save/delete plumbing for one protocol kind.
function useEntries(athleteId, kind) {
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lab_entry_list', { p_athlete: athleteId, p_kind: kind })
    if (error) setMsg({ error: labErrorMessage(error) })
    else setRows((data || []).map((r) => ({ ...r })))
  }, [athleteId, kind])
  useEffect(() => { load() }, [load])
  const save = async (date, data) => {
    setBusy(true)
    const { error } = await supabase.rpc('lab_entry_save', { p_athlete: athleteId, p_kind: kind, p_date: date, p_data: data })
    setBusy(false)
    if (error) { setMsg({ error: labErrorMessage(error) }); return false }
    setMsg({ ok: 'Saved' })
    load()
    return true
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this entry?')) return
    const { error } = await supabase.rpc('lab_entry_delete', { p_id: id })
    if (error) setMsg({ error: labErrorMessage(error) })
    else load()
  }
  return { rows, msg, setMsg, busy, save, remove }
}

function Notes({ value, onChange }) {
  return (
    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 mt-3">Notes
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} className={input} />
    </label>
  )
}

function Msg({ msg }) {
  return (<>{msg?.error && <ErrorNote>{msg.error}</ErrorNote>}{msg?.ok && <StatusNote>{msg.ok}</StatusNote>}</>)
}

function History({ rows, kind, remove, extra }) {
  return (
    <section className={card}>
      <h2 className={h2}>History</h2>
      {rows.length === 0 && <p className={muted}>No entries yet.</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-600 p-3 text-sm space-y-1" data-testid="entry-row">
            <p className="font-bold text-slate-900 dark:text-white">{r.recorded_at}</p>
            <p className="text-slate-800 dark:text-slate-200">{summarizeEntry(kind, r.data)}</p>
            {r.data?.notes && <p className={muted}>{r.data.notes}</p>}
            {extra?.(r, i)}
            <button className={`${adminBtn.danger} mt-1`} onClick={() => remove(r.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GlucoseChart({ readings, duration }) {
  const W = 320
  const H = 100
  const ts = readings.map((r) => r.t)
  const [t0, t1] = [Math.min(...ts), Math.max(...ts, 1)]
  const x = (t) => ((t - t0) / (t1 - t0 || 1)) * W
  const y = (g) => H - ((g - 2) / 12) * H
  const pts = readings.map((r) => `${x(r.t).toFixed(1)},${Math.max(0, Math.min(H, y(r.mmol))).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md h-24" role="img" aria-label="Glucose over the ride">
      <rect x={x(0)} y="0" width={Math.max(0, x(duration ?? t1) - x(0))} height={H} className="fill-sky-100 dark:fill-sky-900/40" />
      <polyline points={pts} fill="none" strokeWidth="2" className="stroke-emerald-600" />
    </svg>
  )
}

export function LabFueling({ athleteId }) {
  const { rows, msg, setMsg, busy, save, remove } = useEntries(athleteId, 'fueling')
  const [f, setF] = useState({ session: 'fed' })
  const [lines, setLines] = useState('')
  const [unit, setUnit] = useState('mmol')
  const [csvStart, setCsvStart] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today)
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))

  const importCsv = async (file) => {
    if (!file) return
    const text = await file.text()
    const r = parseGlucoseCsv(text, csvStart, f.duration_min)
    if (r.error) return setMsg({ error: r.error })
    setLines(r.readings.map((x) => `${x.t}, ${x.mmol}`).join('\n'))
    setUnit('mmol')
    setMsg({ ok: `Imported ${r.readings.length} readings` })
  }

  const submit = async () => {
    const parsed = parseReadingLines(lines, unit)
    if (parsed.error) return setMsg({ error: parsed.error })
    const built = buildEntry('fueling', { ...f, readings: parsed.readings }, notes)
    if (built.error) return setMsg({ error: built.error })
    if (await save(date, built.data)) { setLines(''); setNotes(''); setF({ session: f.session }) }
  }

  const cmp = compareFastedFed(rows)
  return (
    <div className="space-y-4" data-testid="lab-fueling">
      <p className={muted}>Private health data: visible to you and your active coach only. {NOT_MEDICAL_NOTICE}</p>
      <section className={card}>
        <h2 className={h2}>New fueling session</h2>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 max-w-lg">
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">Session
            <select value={f.session} onChange={(e) => set('session')(e.target.value)} className={input}><option value="fed">Fed</option><option value="fasted">Fasted</option></select>
          </label>
          <Field label="Ride duration (min)" value={f.duration_min} onChange={set('duration_min')} />
          <Field label="Carbs (g/h)" value={f.carbs_g_per_h} onChange={set('carbs_g_per_h')} />
          <Field label="Average power (W)" value={f.avg_power_w} onChange={set('avg_power_w')} />
        </div>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 mt-3">
          Glucose readings: one per line as "minutes from ride start, value" (before: negative or 0; during: every 20-30 min; after: duration + 30 and + 60)
          <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6} className={`${input} font-mono`} placeholder={'-10, 5.2\n25, 6.1\n50, 5.8'} data-testid="glucose-lines" />
        </label>
        <div className="flex flex-wrap items-end gap-3 mt-2">
          <label className="text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={input}><option value="mmol">mmol/L</option><option value="mg">mg/dL</option></select>
          </label>
          <label className="text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">Ride start (for CSV import)
            <input type="datetime-local" value={csvStart} onChange={(e) => setCsvStart(e.target.value)} className={input} />
          </label>
          <label className={`${quiet} cursor-pointer`}>Import Libre / Dexcom CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { importCsv(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        <Notes value={notes} onChange={setNotes} />
        <button className={`${primary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={submit}>Save</button>
        <Msg msg={msg} />
      </section>
      {(cmp.fasted || cmp.fed) && (
        <section className={card} data-testid="fasted-fed">
          <h2 className={h2}>Fasted vs fed</h2>
          <table className="text-sm w-full max-w-lg">
            <thead><tr className="text-left text-slate-600 dark:text-slate-300"><th />{['fasted', 'fed'].map((s) => <th key={s} className="capitalize">{s}</th>)}</tr></thead>
            <tbody className="text-slate-800 dark:text-slate-200">
              {[['Sessions', 'sessions'], ['Carbs g/h', 'carbs'], ['Power W', 'power'], ['Glucose avg (during)', 'duringAvg'], ['Glucose min (during)', 'duringMin'], ['Glucose 60 min after', 'after60']].map(([l, k]) => (
                <tr key={k}><th className="text-left font-semibold pr-3">{l}</th>{['fasted', 'fed'].map((s) => <td key={s}>{cmp[s]?.[k] ?? '-'}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <History rows={rows} kind="fueling" remove={remove} extra={(r) => {
        const s = summarizeFueling(r.data)
        return (
          <>
            <GlucoseChart readings={r.data.readings} duration={r.data.duration_min} />
            <p className={muted}>Before {s.before ?? '-'} · 30 min after {s.after30 ?? '-'} · 60 min after {s.after60 ?? '-'} mmol/L (shaded = ride{r.data.carbs_g_per_h != null ? `, ${r.data.carbs_g_per_h} g/h carbs` : ''}{r.data.avg_power_w != null ? `, ${r.data.avg_power_w} W` : ''})</p>
          </>
        )
      }} />
    </div>
  )
}

function NumericLog({ athleteId, kind, fields, title, testId, intro, extra }) {
  const { rows, msg, setMsg, busy, save, remove } = useEntries(athleteId, kind)
  const [values, setValues] = useState({})
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today)
  const submit = async () => {
    const built = buildEntry(kind, values, notes)
    if (built.error) return setMsg({ error: built.error })
    if (await save(date, built.data)) { setValues({}); setNotes('') }
  }
  return (
    <div className="space-y-4" data-testid={testId}>
      <p className={muted}>{intro}</p>
      <section className={card}>
        <h2 className={h2}>{title}</h2>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 sm:max-w-xs">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
        <div className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 max-w-lg">
          {fields.map((fl) => <Field key={fl.key} label={fl.label} value={values[fl.key]} onChange={(v) => setValues((s) => ({ ...s, [fl.key]: v }))} />)}
        </div>
        <Notes value={notes} onChange={setNotes} />
        <button className={`${primary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={submit}>Save</button>
        <Msg msg={msg} />
      </section>
      {extra?.(rows)}
      <History rows={rows} kind={kind} remove={remove} extra={kind === 'fit' ? (r, i) => {
        const d = i === 0 ? fitDeltas(rows) : {}
        return Object.keys(d).length > 0 ? (
          <p className={muted} data-testid="fit-deltas">Since previous: {Object.entries(d).map(([k, v]) => `${FIT_FIELDS.find((x) => x.key === k).label.replace(/ \(.*\)/, '')} ${v > 0 ? '+' : ''}${v}`).join(', ')}</p>
        ) : null
      } : undefined} />
    </div>
  )
}

export const LabBikeFit = ({ athleteId }) => (
  <NumericLog athleteId={athleteId} kind="fit" fields={FIT_FIELDS} title="New position entry" testId="lab-fit"
    intro="Log position changes with a test power and comfort score to see what worked. Compare the newest entry with the previous one." />
)

function Spark({ series }) {
  const lo = Math.min(...series)
  const hi = Math.max(...series)
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * 100},${20 - ((v - lo) / (hi - lo || 1)) * 18}`).join(' ')
  return <svg viewBox="0 0 100 22" className="w-24 h-6" aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.5" className="stroke-emerald-600" /></svg>
}

export const LabPedalling = ({ athleteId }) => (
  <NumericLog athleteId={athleteId} kind="pedalling" fields={PEDALLING_FIELDS} title="New ride" testId="lab-pedalling"
    intro="Needs dual-sided power. Enter the left/right balance, torque effectiveness and pedal smoothness your head unit shows for a ride; the trend compares your latest 3 rides with the 3 before."
    extra={(rows) => {
      const t = pedallingTrend(rows)
      const keys = Object.keys(t)
      if (!keys.length) return null
      return (
        <section className={card} data-testid="pedalling-trend">
          <h2 className={h2}>Trend</h2>
          <ul className="text-sm space-y-1 text-slate-800 dark:text-slate-200">
            {keys.map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span className="w-56 font-semibold">{PEDALLING_FIELDS.find((f) => f.key === k).label}</span>
                <span>{t[k].latest} (avg {t[k].recent}{t[k].change != null ? `, ${t[k].change > 0 ? '+' : ''}${t[k].change} vs before` : ''})</span>
                <Spark series={t[k].series} />
              </li>
            ))}
          </ul>
        </section>
      )
    }} />
)

export function LabCadence({ athleteId }) {
  const { rows, msg, setMsg, busy, save, remove } = useEntries(athleteId, 'cadence')
  const blank = () => DEFAULT_CADENCES.map((rpm) => ({ rpm: String(rpm), power_w: '', hr: '' }))
  const [steps, setSteps] = useState(blank)
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today)
  const upd = (i, k, v) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const submit = async () => {
    const built = buildEntry('cadence', { steps }, notes)
    if (built.error) return setMsg({ error: built.error })
    if (await save(date, built.data)) { setSteps(blank()); setNotes('') }
  }
  return (
    <div className="space-y-4" data-testid="lab-cadence">
      <section className={card}>
        <h2 className={h2}>How to do the test</h2>
        <p className={muted} data-testid="cadence-instruction">{CADENCE_INSTRUCTION}</p>
      </section>
      <section className={card}>
        <h2 className={h2}>New cadence test</h2>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 sm:max-w-xs">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
        <div className="mt-3 space-y-2 max-w-lg">
          {steps.map((s, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <Field label="Cadence (rpm)" value={s.rpm} onChange={(v) => upd(i, 'rpm', v)} />
              <Field label="Power (W)" value={s.power_w} onChange={(v) => upd(i, 'power_w', v)} />
              <Field label="HR (opt.)" value={s.hr} onChange={(v) => upd(i, 'hr', v)} />
            </div>
          ))}
          {steps.length < 12 && <button className={quiet} onClick={() => setSteps((s) => [...s, { rpm: '', power_w: '', hr: '' }])}>Add step</button>}
        </div>
        <Notes value={notes} onChange={setNotes} />
        <button className={`${primary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={submit}>Save</button>
        <Msg msg={msg} />
      </section>
      <History rows={rows} kind="cadence" remove={remove} extra={(r) => (
        <ul className="space-y-1" data-testid="cadence-profile">
          {cadenceProfile(r.data.steps).map((s) => (
            <li key={s.rpm} className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
              <span className="w-20">{s.rpm} rpm</span>
              <span className="h-2 rounded bg-emerald-600" style={{ width: `${Math.max(4, s.pctOfBest)}%`, maxWidth: '12rem' }} />
              <span>{s.power_w} W ({s.pctOfBest}%){s.best ? ' best' : ''}</span>
            </li>
          ))}
        </ul>
      )} />
    </div>
  )
}
