'use client'

import FtpHistoryPanel from '../../../../components/FtpHistoryPanel'
import WeightHistoryPanel from '../../../../components/WeightHistoryPanel'
import LactateThresholdPanel from '../../../../components/LactateThresholdPanel'
import PowerZonesPanel from '../../../../components/PowerZonesPanel'
import AthleteTrainingDefaults from '../../../../components/AthleteTrainingDefaults'
import CoachEditsList from '../../../../components/CoachEditsList'
import { useAthlete } from '../../../../components/AthleteContext'

// The same panels as the rider's own settings, bound to the athlete. Writes are accepted by
// the database only while the viewer actively coaches this rider (RLS / SECURITY DEFINER) and
// are stamped "set by coach", audited and notified to the rider.
export default function AthletePhysiologyPage() {
  const { riderId, athlete } = useAthlete()
  if (!riderId) return null
  return (
    <div className="space-y-6" data-testid="athlete-physiology">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        Physiology &amp; training settings{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      <p className="text-xs text-slate-500">
        Changes are visible to the athlete, labelled “Set by coach”, and they are notified.
      </p>
      <AthleteTrainingDefaults riderId={riderId} athlete={athlete} />
      <FtpHistoryPanel userId={riderId} />
      <WeightHistoryPanel userId={riderId} />
      <LactateThresholdPanel userId={riderId} />
      <PowerZonesPanel userId={riderId} />
      <CoachEditsList riderId={riderId} />
    </div>
  )
}
