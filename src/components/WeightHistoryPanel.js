'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import CoachBadge, { useCoachNames } from './CoachBadge'
import {
  fetchWeightHistory,
  saveWeightEntry,
  deleteWeightEntry,
  validateWeightEntry,
  resolveWeightAt,
} from '../lib/weightHistory'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'

const today = () => new Date().toISOString().slice(0, 10)

// Body weight history (issue #143): effective-dated. Activities keep the weight valid on their
// day (used for W/kg); changing history updates the affected activities.
export default function WeightHistoryPanel({ userId }) {
  const [history, setHistory] = useState([])
  const coachNames = useCoachNames(history)
  const [form, setForm] = useState({ effective_from: today(), weight_kg: '' })
  const [editingId, setEditingId] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { history: rows } = await fetchWeightHistory(supabase, userId)
    setHistory(rows)
  }, [userId])

  useEffect(() => {
    if (userId) load()
  }, [userId, load])

  const current = resolveWeightAt(history, new Date())

  const reset = () => {
    setEditingId(null)
    setForm({ effective_from: today(), weight_kg: '' })
  }

  const save = async () => {
    const { entry, error } = validateWeightEntry(form)
    if (error) return setStatus({ error })
    setBusy(true)
    const res = await saveWeightEntry(supabase, { userId, entry, id: editingId })
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
    const { error } = await deleteWeightEntry(supabase, { userId, id })
    setBusy(false)
    if (error) return setStatus({ error: error.message })
    if (editingId === id) reset()
    await load()
    window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
  }

  const edit = (h) => {
    setEditingId(h.id)
    setStatus(null)
    setForm({ effective_from: h.effective_from, weight_kg: String(h.weight_kg) })
  }

  if (!userId) return null

  const input =
    'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono'

  return (
    <div className="glass-dense p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Body weight</h3>
      <p className="text-[11px] text-slate-500">
        Each entry applies from its date. Activities keep the weight valid on their day and use it for W/kg;
        activities without a weight simply show no W/kg.
      </p>
      {current && (
        <p data-testid="weight-current" className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
          Current · {current.weight_kg} kg
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Effective from</label>
          <input
            type="date"
            value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            className={input}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={form.weight_kg}
            placeholder="e.g. 72.5"
            onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
            className={input}
          />
        </div>
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
                {h.effective_from} · {h.weight_kg} kg{' '}
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
