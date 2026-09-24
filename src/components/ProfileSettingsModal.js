'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from 'next-themes'

export default function ProfileSettingsModal({ isOpen, onClose, user, tracks = [] }) {
  const { setTheme } = useTheme()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    nickname: '',
    weight_kg: '',
    height_cm: '',
    home_track_id: '',
    theme_preference: 'dark',
  })

  // Načtení profilu při otevření
  useEffect(() => {
    if (!isOpen || !user?.id) return

    const loadProfile = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (data) {
        setFormData({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          nickname: data.nickname || '',
          weight_kg: data.weight_kg ?? '',
          height_cm: data.height_cm ?? '',
          home_track_id: data.home_track_id || '',
          theme_preference: data.theme_preference || 'dark',
        })
      }
      setLoading(false)
    }

    loadProfile()
  }, [isOpen, user])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!user?.id) return
    setSaving(true)

    const payload = {
      id: user.id,
      first_name: formData.first_name.trim() || null,
      last_name: formData.last_name.trim() || null,
      nickname: formData.nickname.trim() || null,
      weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
      height_cm: formData.height_cm ? parseFloat(formData.height_cm) : null,
      home_track_id: formData.home_track_id || null,
      theme_preference: formData.theme_preference,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('profiles').upsert(payload)

    if (error) {
      alert('Chyba při ukládání profilu: ' + error.message)
    } else {
      // Okamžitá aplikace nového tématu
      setTheme(formData.theme_preference)
      alert('✓ Profil byl úspěšně uložen.')
      onClose()
    }
    setSaving(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white text-lg font-bold"
        >
          ✕
        </button>

        <div className="mb-6">
          <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
            Nastavení Profilu Jezdce
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Biometrická data a preference pro účet {user?.email}
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Načítám profil...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Jméno
                </label>
                <input
                  type="text"
                  placeholder="Jan"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Příjmení
                </label>
                <input
                  type="text"
                  placeholder="Novák"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Přezdívka / Track Alias
              </label>
              <input
                type="text"
                placeholder="Rocket"
                value={formData.nickname}
                onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Váha (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="82.5"
                  value={formData.weight_kg}
                  onChange={(e) => setFormData({ ...formData, weight_kg: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Výška (cm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="184"
                  value={formData.height_cm}
                  onChange={(e) => setFormData({ ...formData, height_cm: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Domovský velodrom (Home Track)
              </label>
              <select
                value={formData.home_track_id}
                onChange={(e) => setFormData({ ...formData, home_track_id: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Nevybráno --</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.country_code || '---'}, {t.length_m} m)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Výchozí téma rozhraní
              </label>
              <select
                value={formData.theme_preference}
                onChange={(e) => setFormData({ ...formData, theme_preference: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="dark">🌙 Dark (Tmavý Nordic OLED)</option>
                <option value="light">☀️ Light (Světlý laboratorní)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full mt-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider transition"
            >
              {saving ? 'Ukládám do Supabase...' : 'Uložit nastavení profilu'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}