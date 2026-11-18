'use client'

import SettingsShell from '../../../components/SettingsShell'
import useSettingsProfile from '../../../components/useSettingsProfile'
import CoachingPanel from '../../../components/CoachingPanel'
import SharedNotesPanel from '../../../components/SharedNotesPanel'
import MyOnboardingPanel from '../../../components/MyOnboardingPanel'
import CoachCardLink from '../../../components/CoachCardLink'

export default function SettingsCoachingPage() {
  const { user } = useSettingsProfile()
  return (
    <SettingsShell page="coaching" title="Coaching" description="Your coach, shared notes, onboarding answers and coach card.">
      <div className="space-y-6">
        <CoachingPanel userId={user?.id} />
        <SharedNotesPanel />
        <MyOnboardingPanel />
        <CoachCardLink />
      </div>
    </SettingsShell>
  )
}
