'use client'

import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { applyThreshold, activityDay, buildProposals, planApply } from '../lib/applyThresholds'

const LABEL = { ftp: 'FTP', lt2_power: 'LT2 power', lt2_hr: 'LT2 HR', lt1_power: 'LT1 power', lt1_hr: 'LT1 HR' }

function Row({ p, userId, date, onSaved }) {
  const [value, setValue] = useState(String(p.value))
  const [state, setState] = useState({ status: 'idle', message: '' })
  const edited = Number(value) !== p.value

  async function save(confirmOverwrite) {
    setState({ status: 'saving', message: '' })
    const res = await applyThreshold(supabase, { userId, field: p.field, value, date, confirmOverwrite })
    if (res.needsConfirm) return setState({ status: 'confirm', message: `An entry already exists on ${date} and will be replaced.` })
    if (res.error) return setState({ status: 'error', message: res.error })
    setState({ status: 'saved', message: `Saved, effective ${date}` })
    onSaved?.()
  }

  const preview = planApply({ field: p.field, value, date })
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-xs">{LABEL[p.field]}</b>
        {p.fallback && <span className="px-1.5 rounded bg-amber-100 text-amber-700 font-bold">Fallback estimate</span>}
        <span className="text-slate-400">{p.protocol_label} · {p.confidence || 'n/a'} confidence</span>
      </div>
      <div className="text-slate-500">
        Current: <b>{p.current ?? '—'} {p.unit}</b>
        {p.delta != null && <> · Δ <b>{p.delta > 0 ? '+' : ''}{p.delta} {p.unit} ({p.pct > 0 ? '+' : ''}{p.pct}%)</b></>}
        {p.window && <> · window {p.window.start_sec}–{p.window.end_sec}s</>}
      </div>
      {(p.assumptions || []).map((a) => <div key={a} className="text-slate-400">• {a}</div>)}
      {(p.warnings || []).map((w) => (
        <div key={w.code} className={w.severity === 'warn' ? 'text-amber-600' : 'text-slate-400'}>⚠ {w.message}</div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(e.target.value); setState({ status: 'idle', message: '' }) }}
          aria-label={`${LABEL[p.field]} value to apply`}
          className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
        />
        <span>{p.unit}</span>
        {edited && <span className="text-slate-400">(edited from {p.value})</span>}
        <button
          type="button"
          disabled={!userId || !date || !!preview.error || state.status === 'saving' || state.status === 'confirm'}
          onClick={() => save(false)}
          className="px-2 py-1 rounded bg-orange-500 text-white font-bold disabled:opacity-50"
        >
          Apply to profile
        </button>
        {state.status === 'confirm' && (
          <>
            <button type="button" onClick={() => save(true)} className="px-2 py-1 rounded bg-red-500 text-white font-bold">Replace entry</button>
            <button type="button" onClick={() => setState({ status: 'idle', message: '' })} className="text-slate-400">Cancel</button>
          </>
        )}
      </div>
      {preview.error && <div className="text-red-500">{preview.error}</div>}
      {state.message && <div className={state.status === 'error' ? 'text-red-500' : state.status === 'saved' ? 'text-green-600' : 'text-amber-600'}>{state.message}</div>}
    </div>
  )
}

// Review of threshold-test estimates (issue #379). Nothing is applied automatically: each value is
// edited and confirmed individually and written as an effective-dated entry on the activity date.
export default function ThresholdEstimateCard({ summary, activity, userId, onSaved }) {
  const proposals = useMemo(() => buildProposals(summary, activity), [summary, activity])
  const date = activityDay(activity)
  if (!proposals.length) return null
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Threshold estimates · review before applying</div>
      {proposals.map((p) => <Row key={`${p.summary_key}-${p.field}-${p.rep ?? ''}`} p={p} userId={userId} date={date} onSaved={onSaved} />)}
    </div>
  )
}
