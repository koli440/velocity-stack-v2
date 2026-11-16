'use client'

import { useParams } from 'next/navigation'
import LabShell from '../../../components/LabShell'

export default function LabFeaturePage() {
  const { feature } = useParams()
  return <LabShell feature={feature} />
}
