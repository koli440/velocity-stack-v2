'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  GEAR_TEETH_MAX,
  GEAR_TEETH_MIN,
  fetchGearDefault,
  gearDevelopment,
  gearInchesFor,
  gearRatio,
  parseGear,
} from '../lib/gear'

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50'
const labelClass = 'block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1'

/**
 * Saved gear default of one explicit owner ('' / '' when none is set). Pass the athlete's id in
 * athlete (coach) context - never the signed-in coach's - and null to skip loading.
 */
export function useGearDefault(ownerId) {
  const [value, setValue] = useState({ chainring: '', cog: '' })
  const [loaded, setLoaded] = useState(!ownerId)
  useEffect(() => {
    if (!ownerId) {
      setValue({ chainring: '', cog: '' })
      setLoaded(true)
      return
    }
    let active = true
    setLoaded(false)
    fetchGearDefault(supabase, ownerId)
      .then((v) => active && setValue(v))
      .catch(() => {})
      .finally(() => active && setLoaded(true))
    return () => {
      active = false
    }
  }, [ownerId])
  return { ...value, loaded }
}

/**
 * Gear form state prefilled from the owner's saved default (nothing when none is set).
 * `start` is for calculators only: used when no default exists, never saved as data.
 * Signed-out calculators pass a null owner. User edits made before the default arrives win.
 * @returns {{ gear: {chainring: string, cog: string}, setGear: Function, reset: () => void }}
 */
export function useGearState(ownerId, start = null) {
  const def = useGearDefault(ownerId)
  const [gear, setGearState] = useState({ chainring: '', cog: '' })
  const touched = useRef(false)
  const initial = useCallback(() => {
    if (def.chainring && def.cog) return { chainring: def.chainring, cog: def.cog }
    return start ? { chainring: String(start.chainring), cog: String(start.cog) } : { chainring: '', cog: '' }
  }, [def.chainring, def.cog, start])

  useEffect(() => {
    if (def.loaded && !touched.current) setGearState(initial())
  }, [def.loaded, initial])

  const setGear = useCallback((next) => {
    touched.current = true
    setGearState(next)
  }, [])
  const reset = useCallback(() => {
    touched.current = false
    setGearState(initial())
  }, [initial])
  return { gear, setGear, reset }
}

/**
 * The one gear (chainring x cog) input. Controlled with string values so empty stays a valid
 * "no gear" state; validation comes from src/lib/gear.js.
 *
 * @param {object} props
 * @param {string|number} props.chainring
 * @param {string|number} props.cog
 * @param {(next: {chainring: string, cog: string}) => void} props.onChange
 * @param {() => void} [props.onBlur] - fired when focus leaves either field
 * @param {string} [props.label] - group label, e.g. "Gear (optional)"
 * @param {boolean} [props.showStats] - show ratio / gear inches / development
 * @param {boolean} [props.disabled]
 * @param {string} [props.hint]
 * @param {string} [props.className]
 */
export default function GearPicker({
  chainring,
  cog,
  onChange,
  onBlur,
  label = 'Gear',
  showStats = false,
  disabled = false,
  hint,
  className = '',
}) {
  const id = useId()
  const set = (patch) => onChange({ chainring: String(chainring ?? ''), cog: String(cog ?? ''), ...patch })
  const { valid, empty, error } = parseGear(chainring, cog)
  const ratio = gearRatio(chainring, cog)
  const inches = gearInchesFor(chainring, cog)
  const development = gearDevelopment(chainring, cog)
  const errId = `${id}-err`

  return (
    <fieldset className={`min-w-0 ${className}`} disabled={disabled}>
      <legend className={labelClass}>{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-chainring`} className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Chainring (teeth)
          </label>
          <input
            id={`${id}-chainring`}
            type="number"
            inputMode="numeric"
            min={GEAR_TEETH_MIN}
            max={GEAR_TEETH_MAX}
            step={1}
            value={chainring ?? ''}
            onChange={(e) => set({ chainring: e.target.value })}
            onBlur={onBlur}
            aria-invalid={!valid}
            aria-describedby={!valid ? errId : undefined}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-cog`} className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Cog (teeth)
          </label>
          <input
            id={`${id}-cog`}
            type="number"
            inputMode="numeric"
            min={GEAR_TEETH_MIN}
            max={GEAR_TEETH_MAX}
            step={1}
            value={cog ?? ''}
            onChange={(e) => set({ cog: e.target.value })}
            onBlur={onBlur}
            aria-invalid={!valid}
            aria-describedby={!valid ? errId : undefined}
            className={inputClass}
          />
        </div>
      </div>
      {!valid && (
        <p id={errId} role="alert" className="mt-1.5 text-[11px] font-bold text-rose-500">
          {error}
        </p>
      )}
      {valid && showStats && !empty && (
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400" aria-live="polite">
          Ratio <span className="font-bold text-slate-800 dark:text-slate-200">{ratio.toFixed(2)}</span>
          {' · '}
          <span className="font-bold text-slate-800 dark:text-slate-200">{inches.toFixed(1)}&quot;</span> gear inches
          {' · '}
          <span className="font-bold text-slate-800 dark:text-slate-200">{development.toFixed(2)} m</span> development
        </p>
      )}
      {hint && <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">{hint}</p>}
    </fieldset>
  )
}
