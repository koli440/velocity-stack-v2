'use client'

import Link from 'next/link'
import SettingsShell from '../../../components/SettingsShell'
import useSettingsProfile from '../../../components/useSettingsProfile'
import PrivacyZonePanel from '../../../components/PrivacyZonePanel'

export default function SettingsPrivacyPage() {
  const { user } = useSettingsProfile()
  return (
    <SettingsShell page="privacy" title="Privacy" description="Mask the area around home and find your data rights.">
      <PrivacyZonePanel userId={user?.id} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <Link href="/privacy" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Privacy Policy</Link>
        {' · '}
        <Link href="/terms" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Terms of Service</Link>
        {' · To access, export or delete your data, see the Privacy Policy.'}
      </p>
    </SettingsShell>
  )
}
