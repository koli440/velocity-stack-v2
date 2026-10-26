'use client'

// Editor for the exercises and sets of a gym session (issue #335). The rider and the active coach save through
// the audited save_gym_session RPC. Weights are stored in kg; the display unit (kg / lb) is a per-device choice.

import { useEffect, useRef, useState } from 'react'
import {
  blankSet, buildSavePayload, copySet, estimate1RM, fetchExerciseNameHistory, fetchLastSessionSets, kgToUnit,
  LOAD_MODE_LABELS, LOAD_MODES, saveGymSession, SET_KIND_LABELS, SET_KINDS, SIDES, suggestExerciseNames, toEditable,
  unitToKg, VELOCITY_FIELDS, MAX_EXERCISES,
} from '../lib/gymDetail'

const UNIT_KEY = 'vs.gymWeightUnit'

export function useWeightUnit() {
  const [unit, setUnitState] = useState('kg')
  useEffect(() => {
    try {
      if (localStorage.getItem(UNIT_KEY) === 'lb') setUnitState('lb')
    } catch {}
  }, [])
  const setUnit = (u) => {
    setUnitState(u)
    try {
      localStorage.setItem(UNIT_KEY, u)
    } catch {}
  }
  return [unit, setUnit]
}

const input = 'w-full min-w-[3.5rem] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-violet-500'
const small = 'px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40'

export default function GymSessionEditor({ client, activityId, ownerId, detail, unit, onUnit, onCancel, onSaved }) {
  const [rows, setRows] = useState(() => {
    const r = toEditable(detail)
    return r.length ? r : [{ name: '', category: null, subtype: null, notes: null, sets: [blankSet()] }]
  })
  const undoStack = useRef([])
  const [rev, setRev] = useState(0)
  const [more, setMore] = useState(false)
  const [velocity, setVelocity] = useState(() => rows.some((ex) => ex.sets.some((s) => VELOCITY_FIELDS.some((f) => s.metrics?.[f.key] != null))))
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (ownerId) fetchExerciseNameHistory(client, ownerId).then((h) => !cancelled && setHistory(h))
    return () => {
      cancelled = true
    }
  }, [client, ownerId])

  // Every structural change goes through here so it can be undone.
  const change = (fn) => {
    undoStack.current.push(JSON.stringify(rows))
    if (undoStack.current.length > 50) undoStack.current.shift()
    setRows((prev) => fn(structuredClone(prev)))
    setError('')
  }
  const undo = () => {
    const last = undoStack.current.pop()
    if (last) {
      setRows(JSON.parse(last))
      setRev((n) => n + 1)
    }
  }

  const setField = (i, j, key, value) => change((r) => { r[i].sets[j][key] = value; return r })
  const setWeight = (i, j, text) =>
    setField(i, j, 'weight_kg', text === '' ? null : unitToKg(Number(text), unit))
  const setMetric = (i, j, key, text) => change((r) => {
    const m = r[i].sets[j].metrics || {}
    if (text === '') delete m[key]
    else m[key] = Number(text)
    r[i].sets[j].metrics = m
    return r
  })
  const addSet = (i) => change((r) => {
    const prev = r[i].sets[r[i].sets.length - 1]
    r[i].sets.push(prev ? copySet(prev) : blankSet())
    return r
  })
  const removeSet = (i, j) => change((r) => { r[i].sets.splice(j, 1); return r })
  const addExercise = () => change((r) => { r.push({ name: '', category: null, subtype: null, notes: null, sets: [blankSet()] }); return r })
  const removeExercise = (i) => change((r) => { r.splice(i, 1); return r })
  const move = (i, d) => change((r) => {
    const k = i + d
    if (k < 0 || k >= r.length) return r
    ;[r[i], r[k]] = [r[k], r[i]]
    return r
  })
  const repeatLast = async (i) => {
    const sets = await fetchLastSessionSets(client, ownerId, rows[i].name, activityId)
    if (!sets.length) {
      setError(`No earlier session with "${rows[i].name.trim() || 'this exercise'}" found`)
      return
    }
    change((r) => { r[i].sets = sets; return r })
    setRev((n) => n + 1)
  }

  const save = async () => {
    const check = buildSavePayload(rows)
    if (check.error) return setError(check.error)
    setSaving(true)
    const { error: err } = await saveGymSession(client, activityId, rows)
    setSaving(false)
    if (err) return setError(err.message)
    onSaved?.()
  }

  const names = (q) => suggestExerciseNames(history, q)

  return (
    <section className="bg-white dark:bg-surface-darkCard p-4 sm:p-6 rounded-3xl border border-violet-300 dark:border-violet-500/40 shadow-xs space-y-4" data-testid="gym-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Edit exercises &amp; sets</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={small} onClick={() => onUnit(unit === 'kg' ? 'lb' : 'kg')} data-testid="gym-unit">Unit: {unit}</button>
          <button type="button" className={small} onClick={() => setMore((v) => !v)} aria-pressed={more}>{more ? 'Fewer fields' : 'More fields'}</button>
          <button type="button" className={small} onClick={() => setVelocity((v) => !v)} aria-pressed={velocity}>Velocity fields</button>
          <button type="button" className={small} onClick={undo} disabled={!undoStack.current.length} data-testid="gym-undo">Undo</button>
        </div>
      </div>

      <datalist id="gym-exercise-names">
        {names('').map((n) => <option key={n} value={n} />)}
      </datalist>

      {rows.map((ex, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2" data-testid="gym-edit-exercise">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} flex-1 min-w-[10rem] text-sm font-black`}
              list="gym-exercise-names"
              value={ex.name}
              maxLength={120}
              placeholder="Exercise name"
              aria-label={`Exercise ${i + 1} name`}
              onChange={(e) => change((r) => { r[i].name = e.target.value; return r })}
            />
            <button type="button" className={small} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move exercise up">↑</button>
            <button type="button" className={small} onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move exercise down">↓</button>
            <button type="button" className={small} onClick={() => repeatLast(i)} disabled={!ex.name.trim()}>Repeat last session</button>
            <button type="button" className={`${small} text-red-600`} onClick={() => removeExercise(i)}>Remove</button>
          </div>
          {more && (
            <input className={input} value={ex.notes || ''} maxLength={1000} placeholder="Exercise notes" aria-label="Exercise notes"
              onChange={(e) => change((r) => { r[i].notes = e.target.value; return r })} />
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-1 py-1">#</th><th className="px-1">Type</th><th className="px-1">Reps</th><th className="px-1">Weight ({unit})</th>
                  <th className="px-1">RPE</th><th className="px-1">Rest (s)</th>
                  {more && <><th className="px-1">RIR</th><th className="px-1">Tempo</th><th className="px-1">Side</th><th className="px-1">Load</th><th className="px-1">Time (s)</th><th className="px-1">Notes</th></>}
                  {velocity && VELOCITY_FIELDS.map((f) => <th key={f.key} className="px-1">{f.label}</th>)}
                  <th className="px-1">e1RM</th><th />
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((s, j) => (
                  <tr key={j} className="align-top" data-testid="gym-edit-set">
                    <td className="px-1 py-1 font-bold text-slate-500">{j + 1}</td>
                    <td className="px-1 py-1">
                      <select className={input} value={s.kind} aria-label="Set type" onChange={(e) => setField(i, j, 'kind', e.target.value)}>
                        {SET_KINDS.map((k) => <option key={k} value={k}>{SET_KIND_LABELS[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1"><input className={input} inputMode="numeric" value={s.reps ?? ''} aria-label="Reps" onChange={(e) => setField(i, j, 'reps', e.target.value === '' ? null : Number(e.target.value))} /></td>
                    <td className="px-1 py-1"><input className={input} inputMode="decimal" defaultValue={kgToUnit(s.weight_kg, unit) ?? ''} key={`${unit}-${j}-${ex.sets.length}-${rev}`} aria-label="Weight" onChange={(e) => setWeight(i, j, e.target.value)} /></td>
                    <td className="px-1 py-1"><input className={input} inputMode="decimal" value={s.rpe ?? ''} aria-label="RPE" placeholder="1-10" onChange={(e) => setField(i, j, 'rpe', e.target.value === '' ? null : Number(e.target.value))} /></td>
                    <td className="px-1 py-1"><input className={input} inputMode="numeric" value={s.rest_s ?? ''} aria-label="Rest seconds" onChange={(e) => setField(i, j, 'rest_s', e.target.value === '' ? null : Number(e.target.value))} /></td>
                    {more && (
                      <>
                        <td className="px-1 py-1"><input className={input} inputMode="decimal" value={s.rir ?? ''} aria-label="RIR" onChange={(e) => setField(i, j, 'rir', e.target.value === '' ? null : Number(e.target.value))} /></td>
                        <td className="px-1 py-1"><input className={input} value={s.tempo || ''} aria-label="Tempo" placeholder="3-1-1-0" onChange={(e) => setField(i, j, 'tempo', e.target.value)} /></td>
                        <td className="px-1 py-1">
                          <select className={input} value={s.side || ''} aria-label="Side" onChange={(e) => setField(i, j, 'side', e.target.value || null)}>
                            <option value="">Both</option>
                            {SIDES.map((x) => <option key={x} value={x}>{x === 'left' ? 'Left' : 'Right'}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select className={input} value={s.load_mode} aria-label="Load type" onChange={(e) => setField(i, j, 'load_mode', e.target.value)}>
                            {LOAD_MODES.map((m) => <option key={m} value={m}>{LOAD_MODE_LABELS[m]}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1"><input className={input} inputMode="numeric" value={s.duration_s ?? ''} aria-label="Duration seconds" onChange={(e) => setField(i, j, 'duration_s', e.target.value === '' ? null : Number(e.target.value))} /></td>
                        <td className="px-1 py-1"><input className={input} value={s.notes || ''} maxLength={500} aria-label="Set notes" onChange={(e) => setField(i, j, 'notes', e.target.value)} /></td>
                      </>
                    )}
                    {velocity && VELOCITY_FIELDS.map((f) => (
                      <td key={f.key} className="px-1 py-1"><input className={input} inputMode="decimal" value={s.metrics?.[f.key] ?? ''} aria-label={f.label} onChange={(e) => setMetric(i, j, f.key, e.target.value)} /></td>
                    ))}
                    <td className="px-1 py-1 text-slate-400 whitespace-nowrap" title="Estimated 1RM (Epley)">
                      {s.kind !== 'warmup' && s.load_mode === 'weighted' && estimate1RM(s.weight_kg, s.reps) != null ? `≈${kgToUnit(estimate1RM(s.weight_kg, s.reps), unit)}` : '–'}
                    </td>
                    <td className="px-1 py-1"><button type="button" className={small} onClick={() => removeSet(i, j)} aria-label={`Remove set ${j + 1}`}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={small} onClick={() => addSet(i)} data-testid="gym-add-set">+ Set (copies previous)</button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={small} onClick={addExercise} disabled={rows.length >= MAX_EXERCISES} data-testid="gym-add-exercise">+ Exercise</button>
        <div className="flex-1" />
        {error && <span className="text-[11px] font-bold text-red-600" role="alert" data-testid="gym-edit-error">{error}</span>}
        <button type="button" className={small} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} data-testid="gym-save"
          className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-black uppercase disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-slate-400">Weights are stored in kg. RPE 1-10 in steps of 0.5; RIR is optional. Estimated 1RM (Epley) is an estimate and ignores warm-ups.</p>
    </section>
  )
}
