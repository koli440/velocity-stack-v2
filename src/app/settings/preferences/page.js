'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import SettingsShell, { SaveBar, settingsCard, settingsCheck } from '../../../components/SettingsShell'
import useSettingsProfile from '../../../components/useSettingsProfile'
import PushNotificationsToggle from '../../../components/PushNotificationsToggle'
import { formFromRow } from '../../../lib/settingsProfile'
import { readGlassPref, writeGlassPref } from '../../../lib/glass'
import { fetchRequireFollowApproval, setRequireFollowApproval } from '../../../lib/social'

export default function SettingsPreferencesPage() {
  const { user, row, loading, saving, saved, setSaved, save } = useSettingsProfile()
  const [discoverableByEmail, setDiscoverableByEmail] = useState(true)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [reactionsEnabled, setReactionsEnabled] = useState(true)
  const [reactionNotifications, setReactionNotifications] = useState(true)
  const [includeGym, setIncludeGym] = useState(true)
  const [requireApproval, setRequireApproval] = useState(false)
  const [glassEnabled, setGlassEnabled] = useState(true)

  useEffect(() => {
    setGlassEnabled(readGlassPref())
  }, [])

  useEffect(() => {
    if (!row) return
    const f = formFromRow(row)
    setDiscoverableByEmail(f.discoverableByEmail)
    setEmailNotifications(f.emailNotifications)
    setReactionsEnabled(f.reactionsEnabled)
    setReactionNotifications(f.reactionNotifications)
    setIncludeGym(f.includeGym)
  }, [row])

  useEffect(() => {
    if (!user?.id) return
    fetchRequireFollowApproval(supabase, user.id).then((approval) => setRequireApproval(!!approval.value))
  }, [user?.id])

  // Saved immediately (independent of the Save button), as in the former follow panel.
  const handleRequireApprovalChange = async (checked) => {
    const previous = requireApproval
    setRequireApproval(checked)
    const { error } = await setRequireFollowApproval(supabase, { userId: user.id, value: checked })
    if (error) {
      setRequireApproval(previous)
      alert('Error while saving follow setting: ' + error.message)
    }
  }

  const toggle = (set) => (e) => { set(e.target.checked); setSaved(false) }

  const handleSave = (e) => {
    e.preventDefault()
    save('preferences', { discoverableByEmail, emailNotifications, reactionsEnabled, reactionNotifications, includeGym })
  }

  return (
    <SettingsShell page="preferences" title="Preferences" description="Appearance, notifications, reactions and what counts towards your fitness.">
      <form onSubmit={handleSave} className="space-y-6">
        <section className={`${settingsCard} space-y-4`}>
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Preferences</h2>
          <label className={settingsCheck}>
            <input
              type="checkbox"
              checked={glassEnabled}
              onChange={(e) => {
                setGlassEnabled(e.target.checked)
                writeGlassPref(e.target.checked)
              }}
            />
            <span>Background photo &amp; glass effects</span>
          </label>

          <label className={settingsCheck}>
            <input type="checkbox" checked={discoverableByEmail} onChange={toggle(setDiscoverableByEmail)} />
            <span>Let riders find me by typing my exact e-mail address (your e-mail is never shown)</span>
          </label>

          <label className={settingsCheck}>
            <input type="checkbox" checked={requireApproval} onChange={(e) => handleRequireApprovalChange(e.target.checked)} />
            <span>Require my approval for new followers (existing followers are kept)</span>
          </label>

          <label className={settingsCheck}>
            <input type="checkbox" checked={emailNotifications} onChange={toggle(setEmailNotifications)} />
            <span>Email me about new notifications (followers, comments, mentions)</span>
          </label>

          <label className={settingsCheck}>
            <input type="checkbox" checked={reactionsEnabled} onChange={toggle(setReactionsEnabled)} data-testid="reactions-enabled" />
            <span>Let riders who can see my activities give them respect (existing ones are kept)</span>
          </label>

          <label className={settingsCheck}>
            <input type="checkbox" checked={reactionNotifications} onChange={toggle(setReactionNotifications)} data-testid="reaction-notifications" />
            <span>Notify me when someone gives respect (in the app, push and email)</span>
          </label>

          <PushNotificationsToggle />

          <label className={settingsCheck}>
            <input type="checkbox" checked={includeGym} onChange={toggle(setIncludeGym)} data-testid="include-gym-in-fitness" />
            <span>Include gym sessions in fitness (estimated loads in Fitness, Fatigue &amp; Form; your coach sees this choice)</span>
          </label>
        </section>

        <SaveBar saving={saving} disabled={loading || !user} saved={saved} />
      </form>
    </SettingsShell>
  )
}
