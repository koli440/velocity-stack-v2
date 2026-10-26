'use client'

// Exercises and sets of a gym session (issue #326, layer 2). Shown on the activity detail page for gym
// activities; sessions from sources without set data show a short note instead (summary + HR only).

import { useEffect, useState } from 'react'
import { activeSets, fetchGymDetail, gymTotals, restAfter } from '../lib/gymDetail'
import { formatElapsed } from '../lib/activityStreams'

const fmtKg = (v) => (v == null ? '–' : `${Math.round(v * 10) / 10} kg`)
const fmtSec = (v) => (v == null ? '–' : formatElapsed(Math.round(v)))

export default function GymSessionSection({ client, activityId }) {
  const [detail, setDetail] = useState(undefined)

  useEffect(() => {
    let cancelled = false
    fetchGymDetail(client, activityId).then((d) => !cancelled && setDetail(d))
    return () => {
      cancelled = true
    }
  }, [client, activityId])

  if (detail === undefined) return null
  if (!detail) {
    return (
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400" data-testid="gym-no-sets">
        No exercises or sets were recorded for this session. Only duration, heart rate and calories are available
        from this source; upload the .fit file from your watch or strength app to see sets.
      </div>
    )
  }
  const totals = gymTotals(detail)

  return (
    <section className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4" data-testid="gym-sets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Exercises &amp; sets</h3>
        <p className="text-[11px] font-bold text-violet-600 dark:text-violet-400">
          {totals.exercises} exercises · {totals.sets} sets · {totals.reps} reps
          {totals.volumeKg > 0 ? ` · ${Math.round(totals.volumeKg).toLocaleString()} kg volume` : ''}
        </p>
      </div>
      {detail.exercises.map((ex) => (
        <div key={ex.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/60 text-sm font-black text-slate-800 dark:text-slate-100">{ex.name}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-1.5 font-bold">Set</th>
                <th className="px-2 py-1.5 font-bold">Reps</th>
                <th className="px-2 py-1.5 font-bold">Weight</th>
                <th className="px-2 py-1.5 font-bold">Time</th>
                <th className="px-2 py-1.5 font-bold">Rest</th>
              </tr>
            </thead>
            <tbody>
              {ex.sets.map((s, i) => s.set_type === 'rest' ? null : (
                <tr key={s.position} className="border-t border-slate-100 dark:border-slate-800 font-semibold text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-1.5">{activeSets(ex).indexOf(s) + 1}</td>
                  <td className="px-2 py-1.5">{s.reps ?? '–'}</td>
                  <td className="px-2 py-1.5">{fmtKg(s.weight_kg)}</td>
                  <td className="px-2 py-1.5">{fmtSec(s.duration_s)}</td>
                  <td className="px-2 py-1.5">{fmtSec(restAfter(ex, i))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
