'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import { fetchLtHistory } from '../lib/lactateThresholds'
import {
  fetchFitnessActivities,
  dailyLoads,
  computeSeries,
  localDayKey,
  addDays,
} from '../lib/fitnessForm'

/**
 * Loads the rider's own activities (+ LT history for HR estimates) and derives the daily totals.
 * `days` is the displayed range; older history only warms up the averages. `userId` is always filtered
 * explicitly (RLS also lets a coach read athletes' rows). Reusable for the coach view with a rider id.
 */
export function useFitnessData(userId, days) {
  const [state, setState] = useState({ loading: true, error: null, daily: {}, skipped: 0, firstDay: null })

  const load = useCallback(async () => {
    if (!userId) return
    const [acts, lt] = await Promise.all([
      fetchFitnessActivities(supabase, { userId, days }),
      fetchLtHistory(supabase, userId),
    ])
    if (acts.error) {
      setState((s) => ({ ...s, loading: false, error: 'Could not load your activities.' }))
      return
    }
    const { days: daily, skipped } = dailyLoads(acts.data, lt.error ? [] : lt.history)
    setState({ loading: false, error: null, daily, skipped, firstDay: acts.firstDay })
  }, [userId, days])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    load()
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, load)
    return () => window.removeEventListener(ACTIVITIES_CHANGED_EVENT, load)
  }, [load])

  const today = localDayKey(new Date())
  const series = useMemo(
    () => computeSeries(state.daily, { startDay: addDays(today, -(days - 1)), endDay: today }),
    [state.daily, days, today]
  )
  return { ...state, series, today }
}
