'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import VelodromePicker from '../../components/VelodromePicker'
import { fetchTracks } from '../../lib/lookups'
import PrivacyZonePanel from '../../components/PrivacyZonePanel'
import LactateThresholdPanel from '../../components/LactateThresholdPanel'
import PowerZonesPanel from '../../components/PowerZonesPanel'
import FtpHistoryPanel from '../../components/FtpHistoryPanel'
import WeightHistoryPanel from '../../components/WeightHistoryPanel'
import ConnectionsPanel from '../../components/ConnectionsPanel'
import { PROFILE_UPDATED_EVENT } from '../../lib/navigation'
import Icon from '../../components/Icon'
import Avatar from '../../components/Avatar'
import { readGlassPref, writeGlassPref } from '../../lib/glass'
import { fetchRequireFollowApproval, setRequireFollowApproval } from '../../lib/social'
import { uploadAvatar, removeAvatar, validateAvatarFile, ALLOWED_AVATAR_TYPES } from '../../lib/avatars'


export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [homeTrackId, setHomeTrackId] = useState('')
  const [defaultChainring, setDefaultChainring] = useState('58')
  const [defaultCog, setDefaultCog] = useState('14')
  const [crankLength, setCrankLength] = useState('165.0')
  const [themePref, setThemePref] = useState('dark')

  const [discoverableByEmail, setDiscoverableByEmail] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [requireApproval, setRequireApproval] = useState(false)
  const [glassEnabled, setGlassEnabled] = useState(true)

  useEffect(() => {
    setGlassEnabled(readGlassPref())
  }, [])

  useEffect(() => {
    if (!user?.id) return

    const loadProfile = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (data) {
        setFirstName(data.first_name || '')
        setLastName(data.last_name || '')
        setNickname(data.nickname || '')
        setHomeTrackId(data.home_track_id || '')
        setDefaultChainring(data.default_chainring ? String(data.default_chainring) : '58')
        setDefaultCog(data.default_cog ? String(data.default_cog) : '14')
        setCrankLength(data.crank_length_mm ? String(data.crank_length_mm) : '165.0')
        setThemePref(data.theme_preference || 'dark')
        setDiscoverableByEmail(data.discoverable_by_email !== false)
        setAvatarUrl(data.avatar_url || null)
      }
      const approval = await fetchRequireFollowApproval(supabase, user.id)
      setRequireApproval(!!approval.value)
      setLoading(false)
    }

    loadProfile()
  }, [user?.id])

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

  const handleSave = async (e) => {
    e.preventDefault()
    if (!user?.id) return

    setLoading(true)
    setSaved(false)
    const updates = {
      id: user.id,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      nickname: nickname.trim() || null,
      home_track_id: homeTrackId || null,
      default_chainring: defaultChainring ? parseInt(defaultChainring) : null,
      default_cog: defaultCog ? parseInt(defaultCog) : null,
      crank_length_mm: crankLength ? parseFloat(crankLength) : 165.0,
      theme_preference: themePref,
      discoverable_by_email: discoverableByEmail,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('profiles').upsert(updates)
    setLoading(false)

    if (error) {
      alert('Error while saving profile: ' + error.message)
    } else {
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT))
      setSaved(true)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user)
      else router.push('/login')
    })
    fetchTracks(supabase).then(({ data }) => setTracks(data || []))
  }, [router])

  return (
    <section className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Icon name="settings" /> Settings
        </h1>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Athlete profile, gear defaults, privacy and connections.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6 space-y-4">
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
                    disabled={avatarBusy}
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
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Nickname (shown to other riders)
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

        </section>
        <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6 space-y-4">
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Preferences</h2>
          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
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

          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={discoverableByEmail}
              onChange={(e) => setDiscoverableByEmail(e.target.checked)}
            />
            <span>Let riders find me by typing my exact e-mail address (your e-mail is never shown)</span>
          </label>

          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => handleRequireApprovalChange(e.target.checked)}
            />
            <span>Require my approval for new followers (existing followers are kept)</span>
          </label>

        </section>
        <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6 space-y-4">
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Gear defaults</h2>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Home Velodrome
            </label>
            <VelodromePicker tracks={tracks} value={homeTrackId} onChange={setHomeTrackId} favoriteId={null} emptyLabel="-- No Home Track --" compact />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Default Chainring
              </label>
              <input
                type="number"
                value={defaultChainring}
                onChange={(e) => setDefaultChainring(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Default Cog
              </label>
              <input
                type="number"
                value={defaultCog}
                onChange={(e) => setDefaultCog(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                Crank (mm)
              </label>
              <input
                type="number"
                step="0.5"
                value={crankLength}
                onChange={(e) => setCrankLength(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

        </section>
        <div className="space-y-6">
          <FtpHistoryPanel userId={user?.id} />
          <WeightHistoryPanel userId={user?.id} />
          <LactateThresholdPanel userId={user?.id} />
          <PowerZonesPanel userId={user?.id} />
        </div>

        <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-5 md:p-6">
          <ConnectionsPanel userId={user?.id} />
        </section>

        <PrivacyZonePanel userId={user?.id} />

        <div className="sticky bottom-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !user}
            className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-md disabled:opacity-50"
          >
            {loading ? 'Saving profile...' : 'Save Changes'}
          </button>
          {saved && <span className="text-xs font-bold text-emerald-500">Saved</span>}
        </div>
      </form>
    </section>
  )
}
