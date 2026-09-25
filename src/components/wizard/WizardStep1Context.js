'use client'

import { SPORT_TYPES } from '../../lib/activityTaxonomy'

export default function WizardStep1Context({
  formData,
  setFormData,
  tracks = [],
}) {
  const currentSport = SPORT_TYPES.find((s) => s.id === formData.sport_type) || SPORT_TYPES[0]

  const handleSportSelect = (sportId) => {
    const nextSport = SPORT_TYPES.find((s) => s.id === sportId)
    setFormData((prev) => ({
      ...prev,
      sport_type: sportId,
      session_mode: nextSport.modes[0]?.id || '',
      discipline: nextSport.disciplines[0]?.id || '',
      track_id: nextSport.requiresTrack ? prev.track_id : null,
    }))
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. Volba typu sportu (Velké karty) */}
      <div>
        <label className="block text-[11px] uppercase font-bold text-slate-400 mb-2">
          1. Kde a jak trénink proběhl? (Sport Type)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {SPORT_TYPES.map((s) => {
            const isSelected = formData.sport_type === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSportSelect(s.id)}
                className={`p-3.5 rounded-2xl border text-left transition flex flex-col justify-between ${
                  isSelected
                    ? 'border-orange-500 bg-orange-500/10 text-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                    : 'border-slate-200 dark:border-surface-darkBorder bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className="text-2xl mb-1">{s.icon}</span>
                <span className="text-xs font-black tracking-tight">{s.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Režim tréninku vs. Závod */}
      <div>
        <label className="block text-[11px] uppercase font-bold text-slate-400 mb-2">
          2. Účel jednotky (Mode)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {currentSport.modes.map((m) => {
            const isSelected = formData.session_mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, session_mode: m.id }))}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition text-center ${
                  isSelected
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-transparent shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 3. Kontextová volba: Velodrom (Pouze pokud jde o Dráhu) */}
      {currentSport.requiresTrack && (
        <div>
          <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1.5">
            Velodrom
          </label>
          <select
            value={formData.track_id || ''}
            onChange={(e) => setFormData((prev) => ({ ...prev, track_id: e.target.value || null }))}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
          >
            <option value="">-- Vyber velodrom --</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.length_m} m, {t.surface})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 4. Specifická disciplína / Cvičení */}
      <div>
        <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1.5">
          Hlavní disciplína / Zaměření (Discipline Focus)
        </label>
        <select
          value={formData.discipline || ''}
          onChange={(e) => setFormData((prev) => ({ ...prev, discipline: e.target.value }))}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
        >
          {currentSport.disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* 5. Subjektivní pocit jezdce (RPE 1-10) */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className="text-[11px] uppercase font-bold text-slate-400">
            Subjektivní zátěž (RPE: 1 = Vyjetí, 10 = Absolutní vyčerpání)
          </label>
          <span className="text-xs font-black text-orange-500">
            {formData.perceived_exertion || 7} / 10
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          value={formData.perceived_exertion || 7}
          onChange={(e) => setFormData((prev) => ({ ...prev, perceived_exertion: parseInt(e.target.value) }))}
          className="w-full accent-orange-500 h-2 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
        />
      </div>
    </div>
  )
}
