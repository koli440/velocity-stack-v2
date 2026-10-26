'use client'

// Exercises and sets of a gym session (issue #326, layer 2). Shown on the activity detail page for gym
// activities; sessions from sources without set data show a short note instead (summary + HR only).

import { useCallback, useEffect, useState } from 'react'
import {
  activeSets, bestSet, fetchGymDetail, fetchGymEditStamp, gymSummary, restAfter, SET_KIND_LABELS,
  VELOCITY_FIELDS, kgToUnit,
} from '../lib/gymDetail'
import { formatElapsed } from '../lib/activityStreams'
import GymSessionEditor, { useWeightUnit } from './GymSessionEditor'

const fmtW = (kg, unit) => (kg == null ? '–' : `${kgToUnit(kg, unit)} ${unit}`)
const fmtSec = (v) => (v == null ? '–' : formatElapsed(Math.round(v)))

// `ownerId`: the rider owning the session. `coachContext`: viewed from athlete context (an active coach may edit).
export default function GymSessionSection({ client, activityId, ownerId, coachContext = false }) {
  const [detail, setDetail] = useState(undefined)
  const [stamp, setStamp] = useState(null)
  const [viewerId, setViewerId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useWeightUnit()

  const load = useCallback(async () => {
    const [d, st] = await Promise.all([fetchGymDetail(client, activityId), fetchGymEditStamp(client, activityId)])
    setDetail(d)
    setStamp(st)
  }, [client, activityId])

  useEffect(() => {
    let cancelled = false
    load()
    client.auth.getUser().then(({ data }) => !cancelled && setViewerId(data?.user?.id || null)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, load])

  if (detail === undefined) return null
  const isOwner = Boolean(viewerId && ownerId && viewerId === ownerId)
  const canEdit = isOwner || (coachContext && Boolean(viewerId))

  if (editing) {
    return (
      <GymSessionEditor
        client={client}
        activityId={activityId}
        ownerId={ownerId}
        detail={detail}
        unit={unit}
        onUnit={setUnit}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false)
          await load()
        }}
      />
    )
  }
  if (!detail) {
    return (
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400" data-testid="gym-no-sets">
        No exercises or sets were recorded for this session. Only duration, heart rate and calories are available
        from this source; upload the .fit file from your watch or strength app to see sets.
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} data-testid="gym-add-sets" className="ml-2 font-bold text-violet-600 dark:text-violet-400 underline">
            Add exercises &amp; sets
          </button>
        )}
      </div>
    )
  }
  const totals = gymSummary(detail)
  const showVelocity = detail.exercises.some((ex) => ex.sets.some((s) => VELOCITY_FIELDS.some((f) => s.metrics?.[f.key] != null)))

  return (
    <section className="bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs space-y-4" data-testid="gym-sets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Exercises &amp; sets</h3>
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-bold text-violet-600 dark:text-violet-400" data-testid="gym-totals">
            {totals.exercises} exercises · {totals.sets} sets · {totals.reps} reps
            {totals.volumeKg > 0 ? ` · ${Math.round(kgToUnit(totals.volumeKg, unit)).toLocaleString()} ${unit} volume` : ''}
          </p>
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} data-testid="gym-edit" className="px-3 py-1 rounded-lg bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 text-[11px] font-black uppercase">
              Edit
            </button>
          )}
        </div>
      </div>
      {stamp && (
        <p className="text-[10px] text-slate-400" data-testid="gym-edited">
          Edited {stamp.edited_by_coach ? 'by your coach' : 'by the rider'} · {new Date(stamp.edited_at).toLocaleDateString()} · re-imports will not overwrite these values.
          Estimated 1RM uses the Epley formula and is only an estimate.
        </p>
      )}
      {detail.exercises.map((ex) => {
        const best = bestSet(ex)
        return (
        <div key={ex.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/60 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-black text-slate-800 dark:text-slate-100">{ex.name}</span>
            {best && (
              <span className="text-[10px] font-bold text-slate-400" data-testid="gym-best">
                Best set {best.set.reps} × {fmtW(best.set.weight_kg, unit)} · est. 1RM ≈ {fmtW(best.e1rm, unit)}
              </span>
            )}
          </div>
          {ex.notes && <p className="px-4 py-1 text-[11px] text-slate-500">{ex.notes}</p>}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-1.5 font-bold">Set</th>
                <th className="px-2 py-1.5 font-bold">Reps</th>
                <th className="px-2 py-1.5 font-bold">Weight</th>
                <th className="px-2 py-1.5 font-bold">RPE / RIR</th>
                <th className="px-2 py-1.5 font-bold">Time</th>
                <th className="px-2 py-1.5 font-bold">Rest</th>
                {showVelocity && <th className="px-2 py-1.5 font-bold">Velocity</th>}
                <th className="px-2 py-1.5 font-bold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ex.sets.map((s, i) => s.set_type === 'rest' ? null : (
                <tr key={s.position} className="border-t border-slate-100 dark:border-slate-800 font-semibold text-slate-700 dark:text-slate-200">
                  <td className="px-4 py-1.5">
                    {activeSets(ex).indexOf(s) + 1}
                    {s.kind && s.kind !== 'working' && <span className="ml-1 text-[9px] uppercase text-amber-600">{SET_KIND_LABELS[s.kind]}</span>}
                    {s.side && <span className="ml-1 text-[9px] uppercase text-slate-400">{s.side === 'left' ? 'L' : 'R'}</span>}
                  </td>
                  <td className="px-2 py-1.5">{s.reps ?? '–'}</td>
                  <td className="px-2 py-1.5">
                    {s.load_mode === 'bodyweight' && s.weight_kg == null ? 'BW' : fmtW(s.weight_kg, unit)}
                    {s.load_mode === 'assisted' && <span className="text-[9px] text-slate-400"> assist</span>}
                    {s.load_mode === 'bodyweight' && s.weight_kg != null && <span className="text-[9px] text-slate-400"> +BW</span>}
                  </td>
                  <td className="px-2 py-1.5">{[s.rpe != null ? `@${s.rpe}` : null, s.rir != null ? `${s.rir} RIR` : null].filter(Boolean).join(' · ') || '–'}{s.tempo ? ` · ${s.tempo}` : ''}</td>
                  <td className="px-2 py-1.5">{fmtSec(s.duration_s)}</td>
                  <td className="px-2 py-1.5">{fmtSec(restAfter(ex, i))}</td>
                  {showVelocity && (
                    <td className="px-2 py-1.5">
                      {VELOCITY_FIELDS.filter((f) => s.metrics?.[f.key] != null).map((f) => `${f.label.split(' (')[0]} ${s.metrics[f.key]}`).join(' · ') || '–'}
                    </td>
                  )}
                  <td className="px-2 py-1.5 font-normal text-slate-500">{s.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )
      })}
    </section>
  )
}
