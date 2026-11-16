'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage } from '../lib/labRuns'
import {
  BODY_FIELDS, FIELD_KINDS, MOBILITY_ITEMS, SPRINT_FIELDS, buildFieldData, fieldDeltas, summarizeField,
} from '../lib/labFieldForms'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'
const primary = `${btn} bg-indigo-600 border-indigo-600 text-white`
const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300`
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4'
const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm'
const today = () => new Date().toISOString().slice(0, 10)

// Body composition, mobility checklist and sprint test forms with history and change since the previous entry.
export default function LabFieldForms({ athleteId }) {
  const [kind, setKind] = useState('body')
  const [rows, setRows] = useState([])
  const [values, setValues] = useState({})
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lab_field_list', { p_athlete: athleteId, p_kind: null })
    if (error) setMsg({ error: labErrorMessage(error) })
    else setRows(data || [])
  }, [athleteId])
  useEffect(() => { load() }, [load])

  const pick = (k) => { setKind(k); setValues({}); setNotes(''); setMsg(null) }

  const save = async () => {
    const built = buildFieldData(kind, values, notes)
    if (built.error) return setMsg({ error: built.error })
    setBusy(true)
    const { error } = await supabase.rpc('lab_field_save', { p_athlete: athleteId, p_kind: kind, p_date: date, p_data: built.data })
    setBusy(false)
    if (error) return setMsg({ error: labErrorMessage(error) })
    setMsg({ ok: 'Saved' })
    setValues({})
    setNotes('')
    load()
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this result?')) return
    const { error } = await supabase.rpc('lab_field_delete', { p_id: id })
    if (error) setMsg({ error: labErrorMessage(error) })
    else load()
  }

  const fields = kind === 'body' ? BODY_FIELDS : SPRINT_FIELDS
  const deltas = fieldDeltas(kind, rows)
  const history = rows.filter((r) => r.kind === kind)

  return (
    <div className="space-y-4" data-testid="lab-forms">
      <p className="text-xs text-slate-500">Private: visible to the athlete and their active coach only.</p>
      <div className="flex gap-2">
        {FIELD_KINDS.map((k) => (
          <button key={k.key} className={kind === k.key ? primary : quiet} onClick={() => pick(k.key)}>{k.label}</button>
        ))}
      </div>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">New {FIELD_KINDS.find((k) => k.key === kind).label.toLowerCase()}</h2>
        <label className="text-xs text-slate-500">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} w-40 inline-block ml-2`} /></label>
        {kind === 'mobility' ? (
          <ul className="mt-3 space-y-1 text-xs">
            {MOBILITY_ITEMS.map((i) => (
              <li key={i.key} className="flex items-center gap-3">
                <span className="w-44 text-slate-700 dark:text-slate-300">{i.label}</span>
                {['pass', 'limited'].map((v) => (
                  <label key={v} className="flex items-center gap-1">
                    <input type="radio" name={i.key} checked={values[i.key] === v} onChange={() => setValues((s) => ({ ...s, [i.key]: v }))} /> {v === 'pass' ? 'Pass' : 'Limited'}
                  </label>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 max-w-md">
            {fields.map((f) => (
              <label key={f.key} className="text-xs text-slate-500">{f.label}
                <input inputMode="decimal" value={values[f.key] || ''} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} className={input} />
              </label>
            ))}
          </div>
        )}
        <label className="block mt-3 text-xs text-slate-500">Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} className={input} />
        </label>
        <button className={`${primary} mt-2`} disabled={busy} onClick={save}>Save</button>
        {msg?.error && <p className="mt-2 text-xs text-red-600" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="mt-2 text-xs text-emerald-600">{msg.ok}</p>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">History</h2>
        {history.length === 0 && <p className="text-xs text-slate-500">No results yet.</p>}
        <ul className="space-y-3">
          {history.map((r, idx) => (
            <li key={r.id} className="border-t border-slate-100 dark:border-slate-800 pt-2 text-xs" data-testid="field-result">
              <p className="font-bold text-slate-800 dark:text-slate-200">{r.recorded_at}</p>
              <p className="text-slate-700 dark:text-slate-300">{summarizeField(r.kind, r.data)}</p>
              {r.data?.notes && <p className="text-slate-500">{r.data.notes}</p>}
              {idx === 0 && Object.keys(deltas).length > 0 && (
                <p className="text-slate-500" data-testid="field-deltas">
                  Since previous: {Object.entries(deltas).map(([k, d]) => `${k.replace(/_/g, ' ')} ${typeof d === 'number' && d > 0 ? '+' : ''}${d}`).join(', ')}
                </p>
              )}
              <button className={`${quiet} mt-1`} onClick={() => remove(r.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
