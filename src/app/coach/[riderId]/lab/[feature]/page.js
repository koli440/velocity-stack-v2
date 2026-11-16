'use client'

import { useParams } from 'next/navigation'
import LabShell from '../../../../../components/LabShell'
import { useAthlete } from '../../../../../components/AthleteContext'

export default function AthleteLabFeaturePage() {
  const { riderId } = useAthlete()
  const { feature } = useParams()
  return riderId ? <LabShell riderId={riderId} feature={feature} /> : null
}
