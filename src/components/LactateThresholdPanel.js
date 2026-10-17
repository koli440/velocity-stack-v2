'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import CoachBadge, { useCoachNames } from './CoachBadge'
import { fetchLtHistory, saveLtEntry, deleteLtEntry, validateLtEntry, resolveLtAt } from '../lib/lactateThresholds'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'

const EMPTY = { effective_from: '', lt1_power_w: '', lt1_hr: '', lt2_power_w: '', lt2_hr: '' }
const FIELDS = [
  ['lt1_power_w', 'LT1 power (W)'],
  ['lt1_hr', 'LT1 HR (bpm)'],
  ['lt2_power_w', 'LT2 power (W)'],
  ['lt2_hr', 'LT2 HR (bpm)'],
]

const fmt = (v, unit) => (v == null ? '–' : `${v} ${unit}`)

// Lactate thresholds (issue #121): manually entered, effective-dated history. Activities
// snapshot the entry valid at their date, so adding an entry updates later activities only.
export default function LactateThresholdPanel({ userId }) {
  const [history, setHistory] = useState([])
  const coachNames = useCoachNames(history)
  const [form, setForm] = useState({ ...EMPTY, effective_from: new Date().toISOString().slice(0, 10) })
  const [editingId, setEditingId] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { history: rows } = await fetchLtHistory(supabase, userId)
    setHistory(rows)
  }, [userId])

  useEffect(() => {
    if (userId) load()
  }, [userId, load])

  const current = resolveLtAt(history, new Date())

  const reset = () => {
    setEditingId(null)
    setForm({ ...EMPTY, effective_from: new Date().toISOString().slice(0, 10) })
  }

  const save = async () => {
    const { entry, error } = validateLtEntry(form)
    if (error) return setStatus({ error })
    setBusy(true)
    const res = await saveLtEntry(supabase, { userId, entry, id: editingId })
    setBusy(false)
    if (res.error) {
      const dup = res.error.code === '23505'
      return setStatus({ error: dup ? 'An entry already exists for that date' : res.error.message })
    }
    setStatus({ ok: 'Saved' })
    reset()
    await load()
    window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
  }

  const remove = async (id) => {
    setBusy(true)
    const { error } = await deleteLtEntry(supabase, { userId, id })
    setBusy(false)
    if (error) return setStatus({ error: error.message })
    if (editingId === id) reset()
    await load()
    window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
  }

  const edit = (h) => {
    setEditingId(h.id)
    setStatus(null)
    setForm({
      effective_from: h.effective_from,
      lt1_power_w: h.lt1_power_w ?? '',
      lt1_hr: h.lt1_hr ?? '',
      lt2_power_w: h.lt2_power_w ?? '',
      lt2_hr: h.lt2_hr ?? '',
    })
  }

  if (!userId) return null

  const input =
    'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono'

  return (
    <div className="glass-dense p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">
        Lactate thresholds
      </h3>
      <p className="text-[11px] text-slate-500">
        LT1 and LT2 as power and heart rate. Each entry applies from its date; activities keep the values valid
        on their day.
      </p>
      {current && (
        <p data-testid="lt-current" className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
          Current · LT1 {fmt(current.lt1_power_w, 'W')} / {fmt(current.lt1_hr, 'bpm')} · LT2{' '}
          {fmt(current.lt2_power_w, 'W')} / {fmt(current.lt2_hr, 'bpm')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Effective from</label>
          <input
            type="date"
            value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            className={input}
          />
        </div>
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{label}</label>
            <input
              type="number"
              inputMode="numeric"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className={input}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-[11px] font-bold disabled:opacity-50"
        >
          {editingId ? 'Update entry' : 'Add entry'}
        </button>
        {editingId && (
          <button type="button" onClick={reset} className="px-3 py-1.5 text-[11px] font-bold text-slate-500">
            Cancel
          </button>
        )}
      </div>
      {status?.error && <p className="text-[11px] text-red-500">{status.error}</p>}
      {status?.ok && <p className="text-[11px] text-emerald-600">{status.ok}</p>}

      {history.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {history.map((h) => (
            <li key={h.id} className="py-1.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {h.effective_from} · LT1 {fmt(h.lt1_power_w, 'W')}/{fmt(h.lt1_hr, 'bpm')} · LT2{' '}
                {fmt(h.lt2_power_w, 'W')}/{fmt(h.lt2_hr, 'bpm')}{' '}
                <CoachBadge row={h} names={coachNames} />
              </span>
              <span className="flex gap-2 shrink-0">
                <button type="button" onClick={() => edit(h)} className="font-bold text-emerald-600">
                  Edit
                </button>
                <button type="button" disabled={busy} onClick={() => remove(h.id)} className="font-bold text-red-500">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
