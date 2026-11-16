'use client'

import LabShell from '../../../../components/LabShell'
import { useAthlete } from '../../../../components/AthleteContext'

export default function AthleteLabPage() {
  const { riderId } = useAthlete()
  return riderId ? <LabShell riderId={riderId} /> : null
}
