'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { signInMethods } from '../../lib/oauthProfile'
import Avatar from '../../components/Avatar'
import SettingsShell, { SaveBar, settingsCard, settingsInput, settingsLabel } from '../../components/SettingsShell'
import useSettingsProfile from '../../components/useSettingsProfile'
import { formFromRow, legacySettingsRedirect } from '../../lib/settingsProfile'
import { uploadAvatar, removeAvatar, validateAvatarFile, ALLOWED_AVATAR_TYPES } from '../../lib/avatars'

export default function SettingsProfilePage() {
  const router = useRouter()
  const { user, row, loading, saving, saved, setSaved, save } = useSettingsProfile()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  // Old /settings#coaching, #physiology and #onboarding links now live on their own pages.
  useEffect(() => {
    const target = legacySettingsRedirect(window.location.hash)
    if (target) router.replace(target)
  }, [router])

  useEffect(() => {
    if (!row) return
    const f = formFromRow(row)
    setFirstName(f.firstName)
    setLastName(f.lastName)
    setNickname(f.nickname)
    setBirthYear(f.birthYear)
    setAvatarUrl(f.avatarUrl)
  }, [row])

  // Image changes are saved immediately (independent of the Save button).
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const invalid = validateAvatarFile(file)
    if (invalid) {
      setAvatarError(invalid)
      return
    }
    setAvatarBusy(true)
    setAvatarError('')
    const { url, error } = await uploadAvatar(supabase, { userId: user.id, file })
    setAvatarBusy(false)
    if (error) setAvatarError(error.message)
    else setAvatarUrl(url)
  }

  const handleAvatarRemove = async () => {
    setAvatarBusy(true)
    setAvatarError('')
    const { error } = await removeAvatar(supabase, { userId: user.id })
    setAvatarBusy(false)
    if (error) setAvatarError(error.message)
    else setAvatarUrl(null)
  }

  const handleSave = (e) => {
    e.preventDefault()
    save('profile', { firstName, lastName, nickname, birthYear })
  }

  const edit = (set) => (e) => { set(e.target.value); setSaved(false) }

  return (
    <SettingsShell page="profile" title="Profile" description="Your photo, name and how you sign in.">
      <form onSubmit={handleSave} className="space-y-6">
        <section className={`${settingsCard} space-y-4`}>
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Profile</h2>
          <div className="flex items-center gap-4">
            <Avatar
              url={avatarUrl}
              name={nickname || [firstName, lastName].filter(Boolean).join(' ')}
              size="w-16 h-16"
              textSize="text-xl"
            />
            <div className="space-y-1">
              <div className="flex gap-2">
                <label className="cursor-pointer px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition">
                  {avatarBusy ? 'Working…' : avatarUrl ? 'Replace image' : 'Upload image'}
                  <input
                    type="file"
                    accept={ALLOWED_AVATAR_TYPES.join(',')}
                    onChange={handleAvatarChange}
                    disabled={avatarBusy || !user}
                    className="hidden"
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleAvatarRemove}
                    disabled={avatarBusy}
                    className="px-3 py-1.5 rounded-xl border border-rose-500/30 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400">JPG, PNG or WebP, max 10 MB.</p>
              {avatarError && <p className="text-[11px] text-rose-500">{avatarError}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={settingsLabel}>First Name</label>
              <input type="text" value={firstName} onChange={edit(setFirstName)} className={settingsInput} />
            </div>
            <div>
              <label className={settingsLabel}>Last Name</label>
              <input type="text" value={lastName} onChange={edit(setLastName)} className={settingsInput} />
            </div>
          </div>

          <div>
            <label className={settingsLabel}>Nickname (shown to other riders)</label>
            <input type="text" value={nickname} onChange={edit(setNickname)} className={settingsInput} />
          </div>

          <div>
            <label className={settingsLabel}>Year of birth (private; used for the Lab age adjustment)</label>
            <input type="text" inputMode="numeric" maxLength={4} value={birthYear} onChange={edit(setBirthYear)} className={settingsInput} />
          </div>
        </section>

        <section className={`${settingsCard} space-y-2`}>
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Sign-in methods</h2>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {signInMethods(user).map((m) => (m === 'google' ? 'Google' : m === 'email' ? 'Email and password' : m)).join(', ') || 'Email and password'}
          </p>
          {signInMethods(user).length > 0 && !signInMethods(user).includes('email') && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              You signed up with Google, so there is no password to change. To also sign in with a password, use "Forgot password?" on the login page with the same email address.
            </p>
          )}
        </section>

        <SaveBar saving={saving} disabled={loading || !user} saved={saved} />
      </form>
    </SettingsShell>
  )
}
