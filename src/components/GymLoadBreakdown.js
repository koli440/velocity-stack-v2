'use client'

// Gym load header stat + expandable "How this was estimated" (issue #336). Reads the stored breakdown
// (gym_load_details, visible to the rider and an active coach); the load is a model ESTIMATE, never a measurement.

import { useEffect, useState } from 'react'
import { requestGymLoad } from '../lib/gymLoadClient'
import { describeBreakdownRow, describeGymFlags, describeGymInputs } from '../lib/gymLoadDescribe'

export default function GymLoadBreakdown({ client, activityId, refreshKey = 0, onLoad, autoScore = false }) {
  const [row, setRow] = useState(undefined)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const read = () =>
      client.from('gym_load_details').select('model, computed_at, detail').eq('activity_id', activityId).maybeSingle()
    const apply = ({ data }) => {
      if (cancelled) return null
      setRow(data || null)
      if (data?.detail && onLoad) onLoad({ training_load: data.detail.load, gym_load_model: data.model })
      return data
    }
    read().then(async (r) => {
      // Older or just-imported session never scored: do it once now (owner or coach), then show it.
      if (!apply(r) && autoScore && !cancelled && (await requestGymLoad(activityId))) read().then(apply)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, activityId, refreshKey])

  if (!row?.detail) return null
  const { detail } = row
  const flags = describeGymFlags(detail.flags)
  const inputs = describeGymInputs(detail)

  return (
    <section className="bg-white dark:bg-surface-darkCard p-4 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs" data-testid="gym-load">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-900 dark:text-white" data-testid="gym-load-value">
          Training load ~{Math.round(detail.load)} <span className="text-[10px] font-bold uppercase text-slate-400">estimate</span>
        </p>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="gym-load-toggle" className="text-[11px] font-black text-violet-600 dark:text-violet-400 underline">
          How this was estimated
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 text-xs text-slate-600 dark:text-slate-300" data-testid="gym-load-details">
          <p>Based on how hard each exercise was (intensity and dynamics), not on how close to failure. No effort rating is used and heart rate is only a small adjustment.</p>
          <ul className="space-y-1">
            {(detail.breakdown || []).map((b) => {
              const d = describeBreakdownRow(b)
              return (
                <li key={b.name_key || b.name} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
                  <span className="font-black text-slate-800 dark:text-slate-100">{d.name}</span>
                  <span> · {d.sets} · intensity {d.intensity} from {d.source} · stress {d.stress}</span>
                </li>
              )
            })}
          </ul>
          {inputs.length > 0 && <ul className="list-disc pl-5">{inputs.map((t) => <li key={t}>{t}</li>)}</ul>}
          {flags.length > 0 && (
            <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300" data-testid="gym-load-flags">{flags.map((t) => <li key={t}>{t}</li>)}</ul>
          )}
          <p className="text-[10px] text-slate-400">Calculated when the session was saved{row.computed_at ? ` (${new Date(row.computed_at).toLocaleDateString()})` : ''}; it is not changed when you add later sessions.</p>
        </div>
      )}
    </section>
  )
}
