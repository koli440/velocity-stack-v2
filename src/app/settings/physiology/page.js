'use client'

import SettingsShell from '../../../components/SettingsShell'
import useSettingsProfile from '../../../components/useSettingsProfile'
import LactateThresholdPanel from '../../../components/LactateThresholdPanel'
import PowerZonesPanel from '../../../components/PowerZonesPanel'
import FtpHistoryPanel from '../../../components/FtpHistoryPanel'
import WeightHistoryPanel from '../../../components/WeightHistoryPanel'
import CoachEditsList from '../../../components/CoachEditsList'

export default function SettingsPhysiologyPage() {
  const { user } = useSettingsProfile()
  return (
    <SettingsShell page="physiology" title="Physiology" description="FTP, weight, lactate thresholds and power zones.">
      <div id="physiology" className="space-y-6 scroll-mt-20">
        <FtpHistoryPanel userId={user?.id} />
        <WeightHistoryPanel userId={user?.id} />
        <LactateThresholdPanel userId={user?.id} />
        <PowerZonesPanel userId={user?.id} />
        <CoachEditsList riderId={user?.id} />
      </div>
    </SettingsShell>
  )
}
