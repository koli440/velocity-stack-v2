'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchLtHistory, resolveLtAt, ltFromHistoryEntry } from '../lib/lactateThresholds'
import { fetchFtpHistory, ftpAt } from '../lib/ftpHistory'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import {
  DEFAULT_ZONE_PCTS,
  ZONE_NAMES,
  ZONE_PCT_FIELDS,
  computeZones,
  deleteZoneEntry,
  fetchZoneHistory,
  formatZoneRange,
  resolveZonesAt,
  saveZoneEntry,
  validateZoneEntry,
  zonePctsFromEntry,
  zoneRanges,
} from '../lib/powerZones'

const today = () => new Date().toISOString().slice(0, 10)
const defaultsForm = () => ({
  effective_from: today(),
  ...Object.fromEntries(ZONE_PCT_FIELDS.map((k, i) => [k, DEFAULT_ZONE_PCTS[i]])),
})

// Power zones (issue #194): editable upper bounds as % of LT1 (Z1, Z2) and LT2 (Z3-Z5), shown with
// the resulting watts. Effective-dated; activities snapshot the entry valid on their day.
export default function PowerZonesPanel({ userId }) {
  const [history, setHistory] = useState([])
  const [ltHistory, setLtHistory] = useState([])
  const [ftpHistory, setFtpHistory] = useState([])
  const [form, setForm] = useState(defaultsForm)
  const [editingId, setEditingId] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [z, lt, ftp] = await Promise.all([
      fetchZoneHistory(supabase, userId),
      fetchLtHistory(supabase, userId),
      fetchFtpHistory(supabase, userId),
    ])
    setHistory(z.history)
    setLtHistory(lt.history)
    setFtpHistory(ftp.history)
  }, [userId])

  useEffect(() => {
    if (userId) load()
  }, [userId, load])

  // Watts preview for the form as typed, against the LT/FTP valid on its effective date.
  const preview = useMemo(() => {
    const { entry } = validateZoneEntry(form)
    const day = form.effective_from || today()
    const lt = ltFromHistoryEntry(resolveLtAt(ltHistory, day))
    const zones = computeZones({ lt, ftp: ftpAt(ftpHistory, day), pcts: entry ? zonePctsFromEntry(entry) : null })
    return zones ? { zones, ranges: zoneRanges(zones) } : null
  }, [form, ltHistory, ftpHistory])

  const reset = () => {
    setEditingId(null)
    setForm(defaultsForm())
  }

  const afterChange = async () => {
    await load()
    window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
  }

  const save = async () => {
    const { entry, error } = validateZoneEntry(form)
    if (error) return setStatus({ error })
    setBusy(true)
    const res = await saveZoneEntry(supabase, { userId, entry, id: editingId })
    setBusy(false)
    if (res.error) {
      const dup = res.error.code === '23505'
      return setStatus({ error: dup ? 'An entry already exists for that date' : res.error.message })
    }
    setStatus({ ok: 'Saved' })
    reset()
    await afterChange()
  }

  const remove = async (id) => {
    setBusy(true)
    const { error } = await deleteZoneEntry(supabase, { userId, id })
    setBusy(false)
    if (error) return setStatus({ error: error.message })
    if (editingId === id) reset()
    await afterChange()
  }

  const edit = (h) => {
    setEditingId(h.id)
    setStatus(null)
    setForm({ effective_from: h.effective_from, ...Object.fromEntries(ZONE_PCT_FIELDS.map((k) => [k, h[k]])) })
  }

  if (!userId) return null

  const input =
    'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono'
  const current = resolveZonesAt(history, new Date())
  const currentPcts = zonePctsFromEntry(current)

  return (
    <div className="glass-dense p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Power zones</h3>
      <p className="text-[11px] text-slate-500">
        Z1–Z6 from your lactate thresholds: Z1 and Z2 are limits in % of LT1, Z3–Z5 limits in % of LT2, Z6 is
        everything above Z5. Without LT power the zones are estimated from FTP (LT1 ≈ 75%, LT2 ≈ 100%). Use them
        in templates, e.g. <span className="font-mono">work 15min ±3% @ Z3</span>.
      </p>
      <p data-testid="zones-current" className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
        {current ? `Custom from ${current.effective_from}: ${currentPcts?.join('/')}%` : 'Using default boundaries (75/100% LT1, 100/105/120% LT2)'}
      </p>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3">
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Effective from</label>
          <input
            type="date"
            value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            className={input}
          />
        </div>
        {ZONE_PCT_FIELDS.map((key, i) => (
          <div key={key}>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Z{i + 1} max (% {i < 2 ? 'LT1' : 'LT2'})
            </label>
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

      {preview ? (
        <div data-testid="zones-preview" className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">
            LT1 {preview.zones.lt1} W · LT2 {preview.zones.lt2} W{preview.zones.estimated ? ' · estimated from FTP' : ''}
          </p>
          <ul>
            {preview.ranges.map((r) => (
              <li key={r.zone}>
                {r.label} {ZONE_NAMES[r.zone - 1]}: {formatZoneRange(r)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">Add LT1/LT2 power (or FTP) to see zones in watts.</p>
      )}

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
                {h.effective_from} · {zonePctsFromEntry(h)?.join('/')}%
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
