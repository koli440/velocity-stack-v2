'use client'

import FitnessView from '../../../../components/FitnessView'
import { useAthlete } from '../../../../components/AthleteContext'

// The athlete's Fitness / Fatigue / Form (issue #290). Data comes through the coach-gated
// coach_fitness_activities() RPC with the athlete's own FTP / heart rate thresholds.
export default function AthleteFitnessPage() {
  const { riderId } = useAthlete()
  if (!riderId) return null
  return <FitnessView userId={riderId} coach />
}
