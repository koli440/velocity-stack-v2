'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFitnessData } from './useFitnessData'
import { fetchPlannedInRange } from '../lib/plannedWorkouts'
import { projectFitness, PROJECTION_MAX_DAYS } from '../lib/fitnessProjection'
import { addDays, daysBetween, localDayKey } from '../lib/fitnessForm'

/**
 * Projected form on race day for the upcoming races (<= 8 weeks) of ONE rider: Map(raceId -> raceForm).
 * Loads nothing unless such a race is visible. Same data paths as the Fitness page (own: explicit
 * owner filter; coach: coach-gated RPC), same `today`, same projection (default 4-week plan horizon
 * stretched to the furthest race).
 */
export function useRaceForms(riderId, races, { coach = false } = {}) {
  const probe = useMemo(() => localDayKey(new Date()), [])
  const upcoming = useMemo(
    () => (races || []).filter((r) => r.race_date > probe && daysBetween(probe, r.race_date) <= PROJECTION_MAX_DAYS),
    [races, probe]
  )
  const { daily, today, loading, error } = useFitnessData(upcoming.length ? riderId : null, 42, { coach })
  const [planned, setPlanned] = useState([])
  useEffect(() => {
    if (!upcoming.length || !riderId) return
    fetchPlannedInRange(supabase, { riderId, startDay: addDays(probe, 1), endDay: addDays(probe, PROJECTION_MAX_DAYS) }).then(
      ({ data }) => setPlanned(data || [])
    )
  }, [riderId, upcoming.length, probe])
  return useMemo(() => {
    if (loading || error || !upcoming.length) return new Map()
    const farthest = Math.max(...upcoming.map((r) => daysBetween(today, r.race_date)))
    const p = projectFitness(daily, { today, planned, races: upcoming, horizonDays: farthest })
    return new Map(p.raceForms.map((f) => [f.race.id, f]))
  }, [loading, error, upcoming, daily, today, planned])
}
