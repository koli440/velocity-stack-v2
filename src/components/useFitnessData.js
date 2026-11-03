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
  WARMUP_DAYS,
} from '../lib/fitnessForm'
import { requestGymLoadBackfill } from '../lib/gymLoadClient'
import { fetchCoachFitnessRows, groupFitnessRows } from '../lib/coachFitness'

/**
 * Loads the rider's own activities (+ LT history for HR estimates) and derives the daily totals.
 * `days` is the displayed range; older history only warms up the averages. `userId` is always filtered
 * explicitly (RLS also lets a coach read athletes' rows).
 * `coach: true` reads an athlete (userId = rider id) through the coach-gated coach_fitness_activities() RPC,
 * which carries the athlete's own thresholds; the coach never queries the raw activities table.
 */
export function useFitnessData(userId, days, { coach = false } = {}) {
  const [state, setState] = useState({ loading: true, error: null, daily: {}, skipped: 0, firstDay: null, includeGym: true })

  const load = useCallback(async () => {
    if (!userId) return
    if (coach) {
      const { rows, error } = await fetchCoachFitnessRows(supabase, { riderIds: [userId], days: days + WARMUP_DAYS })
      if (error) {
        setState((s) => ({ ...s, loading: false, error: 'Could not load the athlete\u2019s activities.' }))
        return
      }
      const group = groupFitnessRows(rows).get(userId)
      const { days: daily, skipped } = dailyLoads(group?.rides || [])
      setState({ loading: false, error: null, daily, skipped, firstDay: group?.firstActivityAt ? localDayKey(group.firstActivityAt) : null, includeGym: group?.includeGym !== false })
      return
    }
    // Missing column / no profile row: gym stays included (the default).
    const { data: prof } = await supabase.from('profiles').select('include_gym_in_fitness').eq('id', userId).maybeSingle()
    const includeGym = prof?.include_gym_in_fitness !== false
    const [acts, lt] = await Promise.all([
      fetchFitnessActivities(supabase, { userId, days, includeGym }),
      fetchLtHistory(supabase, userId),
    ])
    if (acts.error) {
      setState((s) => ({ ...s, loading: false, error: 'Could not load your activities.' }))
      return
    }
    const { days: daily, skipped } = dailyLoads(acts.data, lt.error ? [] : lt.history)
    setState({ loading: false, error: null, daily, skipped, firstDay: acts.firstDay, includeGym })
  }, [userId, days, coach])

  // Own view only: score gym sessions that never were (older imports); the self-service route does a small batch.
  useEffect(() => {
    if (!userId || coach) return
    let cancelled = false
    requestGymLoadBackfill().then((r) => {
      if (!cancelled && r?.stored > 0) window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT))
    })
    return () => { cancelled = true }
  }, [userId, coach])

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
