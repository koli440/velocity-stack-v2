'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ProfileSettingsModal({
  isOpen,
  onClose,
  user,
  tracks = [],
}) {
  const [loading, setLoading] = useState(false)
  const [registeringWebhook, setRegisteringWebhook] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [homeTrackId, setHomeTrackId] = useState('')
  const [defaultChainring, setDefaultChainring] = useState('58')
  const [defaultCog, setDefaultCog] = useState('14')
  const [crankLength, setCrankLength] = useState('165.0')
  const [themePref, setThemePref] = useState('dark')

  // Intervals.icu údaje
  const [intervalsAthleteId, setIntervalsAthleteId] = useState('')
  const [intervalsApiKey, setIntervalsApiKey] = useState('')
  const [webhookStatus, setWebhookStatus] = useState(null)

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
        setThemePref(data.theme_preference || 'dark')
        setIntervalsAthleteId(data.intervals_athlete_id || '')
        setIntervalsApiKey(data.intervals_api_key || '')
      }
      setLoading(false)
    }

    loadProfile()
  }, [user, isOpen])

  // Pomocná funkce pro registraci webhooku u Intervals.icu
  const registerAthleteWebhook = async (athId, key) => {
    try {
      const res = await fetch('/api/webhooks/intervals/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId: athId.trim(),
          apiKey: key.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        return { ok: true, msg: 'Webhook aktivní na Intervals.icu' }
      } else {
        return { ok: false, msg: data.error || 'Registrace webhooku selhala' }
      }
    } catch (err) {
      return { ok: false, msg: err.message }
    }
  }

  // Uložení profilu + automatická registrace webhooku
  const handleSave = async (e) => {
    e.preventDefault()
    if (!user?.id) return

    setLoading(true)
    const athId = intervalsAthleteId.trim()
    const apiKey = intervalsApiKey.trim()

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
      intervals_athlete_id: athId || null,
      intervals_api_key: apiKey || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('profiles').upsert(updates)

    if (error) {
      setLoading(false)
      alert('Chyba při ukládání profilu: ' + error.message)
      return
    }

    // Pokud uživatel zadal ID i klíč, automaticky aktivujeme Webhook
    if (athId && apiKey) {
      const result = await registerAthleteWebhook(athId, apiKey)
      setWebhookStatus(result)
      if (!result.ok) {
        alert('Profil byl uložen, ale nepodařilo se zaregistrovat Webhook: ' + result.msg)
      }
    }

    setLoading(false)
    onClose()
  }

  // Ruční spuštění registrace Webhooku
  const handleManualRegisterWebhook = async () => {
    if (!intervalsAthleteId || !intervalsApiKey) {
      alert('Nejprve vyplňte Athlete ID a API Key.')
      return
    }

    setRegisteringWebhook(true)
    setWebhookStatus(null)

    const result = await registerAthleteWebhook(intervalsAthleteId, intervalsApiKey)
    setWebhookStatus(result)
    setRegisteringWebhook(false)
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
              Nickname / Roster Display
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Home Velodrome
            </label>
            <select
              value={homeTrackId}
              onChange={(e) => setHomeTrackId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- No Home Track --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
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

          {/* Sekce pro Intervals.icu */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🔄</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Intervals.icu Sync Credentials
              </h3>
            </div>
            <p className="text-[11px] text-slate-400">
              Při uložení se automaticky zaregistruje webhook pro stahování jízd z Garmin & Wahoo.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                  Athlete ID (např. i228280)
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
                  placeholder="Z nastavení intervals.icu"
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleManualRegisterWebhook}
                disabled={registeringWebhook || !intervalsAthleteId || !intervalsApiKey}
                className="py-1.5 px-3 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 text-[11px] font-bold transition disabled:opacity-40"
              >
                {registeringWebhook ? 'Ověřuji...' : '🔗 Testovat registraci Webhooku'}
              </button>

              {webhookStatus && (
                <span
                  className={`text-[11px] font-bold ${
                    webhookStatus.ok ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {webhookStatus.msg}
                </span>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-md disabled:opacity-50"
          >
            {loading ? 'Ukládám profil a registruji webhook...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}