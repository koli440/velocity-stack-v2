'use client'

import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_RIDE_TYPE, RIDE_TYPES, effectiveRideType } from '../lib/rideType'

/**
 * Ride type chosen for a new import/upload; starts at the owner's Settings default (road when unset)
 * and never changes by itself once the user picked a value. Loads one explicit owner's profile.
 */
export function useRideTypeState(ownerId) {
  const [rideType, setRideTypeState] = useState(DEFAULT_RIDE_TYPE)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!ownerId || touched) return
    let active = true
    supabase
      .from('profiles')
      .select('default_ride_type')
      .eq('id', ownerId)
      .maybeSingle()
      .then(({ data }) => active && setRideTypeState(effectiveRideType(data?.default_ride_type)))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [ownerId, touched])
  const setRideType = (v) => {
    setTouched(true)
    setRideTypeState(v)
  }
  return [rideType, setRideType]
}

export default function RideTypeSelect({ value, onChange, disabled = false, className = '' }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
        Ride type
      </label>
      <select
        id={id}
        value={effectiveRideType(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
      >
        {RIDE_TYPES.map((t) => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </select>
    </div>
  )
}
