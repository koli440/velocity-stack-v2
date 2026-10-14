'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import VelodromePicker from './VelodromePicker'
import PrivacyZonePanel from './PrivacyZonePanel'
import Avatar from './Avatar'
import { uploadAvatar, removeAvatar, validateAvatarFile, ALLOWED_AVATAR_TYPES } from '../lib/avatars'

export default function ProfileSettingsModal({
  isOpen,
  onClose,
  user,
  tracks = [],
}) {
  const [loading, setLoading] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [homeTrackId, setHomeTrackId] = useState('')
  const [defaultChainring, setDefaultChainring] = useState('58')
  const [defaultCog, setDefaultCog] = useState('14')
  const [crankLength, setCrankLength] = useState('165.0')
  const [ftpWatts, setFtpWatts] = useState('')
  const [themePref, setThemePref] = useState('dark')

  // Intervals.icu data
  const [intervalsAthleteId, setIntervalsAthleteId] = useState('')
  const [intervalsApiKey, setIntervalsApiKey] = useState('')
  const [discoverableByEmail, setDiscoverableByEmail] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  useEffect(() => {
    if (!user?.id || !isOpen) return

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
        setFtpWatts(data.ftp_w ? String(data.ftp_w) : '')
        setThemePref(data.theme_preference || 'dark')
        setDiscoverableByEmail(data.discoverable_by_email !== false)
        setAvatarUrl(data.avatar_url || null)
      }
      const { data: secrets } = await supabase
        .from('profile_secrets')
        .select('intervals_athlete_id, intervals_api_key')
        .eq('user_id', user.id)
        .maybeSingle()
      setIntervalsAthleteId(secrets?.intervals_athlete_id || '')
      setIntervalsApiKey(secrets?.intervals_api_key || '')
      setLoading(false)
    }

    loadProfile()
  }, [user, isOpen])

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

  const handleSave = async (e) => {
    e.preventDefault()
    if (!user?.id) return

    setLoading(true)
    const updates = {
      id: user.id,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      nickname: nickname.trim() || null,
      home_track_id: homeTrackId || null,
      default_chainring: defaultChainring ? parseInt(defaultChainring) : null,
      default_cog: defaultCog ? parseInt(defaultCog) : null,
      crank_length_mm: crankLength ? parseFloat(crankLength) : 165.0,
      ftp_w: ftpWatts ? parseInt(ftpWatts) : null,
      theme_preference: themePref,
      discoverable_by_email: discoverableByEmail,
      updated_at: new Date().toISOString(),
    }

    let { error } = await supabase.from('profiles').upsert(updates)
    if (!error) {
      ;({ error } = await supabase.from('profile_secrets').upsert({
        user_id: user.id,
        intervals_athlete_id: intervalsAthleteId.trim() || null,
        intervals_api_key: intervalsApiKey.trim() || null,
        updated_at: new Date().toISOString(),
      }))
    }
    setLoading(false)

    if (error) {
      alert('Error while saving profile: ' + error.message)
    } else {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-surface-darkCard p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold p-1 rounded-lg transition"
        >
          ✕
        </button>

        <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-4">
          Athlete Profile & Gear
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
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

          <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={discoverableByEmail}
              onChange={(e) => setDiscoverableByEmail(e.target.checked)}
            />
            <span>Let riders find me by typing my exact e-mail address (your e-mail is never shown)</span>
          </label>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Home Velodrome
            </label>
            <VelodromePicker tracks={tracks} value={homeTrackId} onChange={setHomeTrackId} favoriteId={null} emptyLabel="-- No Home Track --" compact />
          </div>

          <div className="grid grid-cols-3 gap-3">
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

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              FTP / Threshold Power (W)
            </label>
            <input
              type="number"
              value={ftpWatts}
              onChange={(e) => setFtpWatts(e.target.value)}
              placeholder="e.g. 280"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Used to calculate Intensity Factor and Training Load for uploaded activities.
            </p>
          </div>

          {/* Section for Intervals.icu */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🔄</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Intervals.icu API Credentials
              </h3>
            </div>
            <p className="text-[11px] text-slate-400">
              Credentials for manually importing workouts from Garmin & Wahoo devices.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Athlete ID (e.g. i228280)
                </label>
                <input
                  type="text"
                  value={intervalsAthleteId}
                  onChange={(e) => setIntervalsAthleteId(e.target.value)}
                  placeholder="iXXXXX"
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={intervalsApiKey}
                  onChange={(e) => setIntervalsApiKey(e.target.value)}
                  placeholder="From intervals.icu settings"
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>
          </div>

          <PrivacyZonePanel userId={user?.id} />

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-md disabled:opacity-50"
          >
            {loading ? 'Saving profile...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}