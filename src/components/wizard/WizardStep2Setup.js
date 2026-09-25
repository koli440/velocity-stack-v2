'use client'

export default function WizardStep2Setup({ formData, setFormData }) {
  const chainring = parseInt(formData.chainring) || 58
  const cog = parseInt(formData.cog) || 14
  const crankLength = parseFloat(formData.crank_length_mm) || 165.0

  // Standardní průměr 700c dráhového kola s galuskou (~670 mm = 26.38 palců)
  const WHEEL_DIAMETER_INCHES = 26.8
  const gearRatio = (chainring / cog).toFixed(2)
  const gearInches = ((chainring / cog) * WHEEL_DIAMETER_INCHES).toFixed(1)
  const developmentMeters = (((chainring / cog) * (Math.PI * 0.67))).toFixed(2)

  // Rychlé předvolby řídítek
  const HANDLEBAR_PRESETS = [
    { label: 'Sprint Drops (Berany)', value: 'Vision Metron 4 / Deda Pista' },
    { label: 'Aerobars (Nástavce na stíhačku)', value: 'WattShop Anemoi / Velobike Pursuit' },
    { label: 'Bunch Bunch (Úzká silniční)', value: '320mm Bunch Bars' },
  ]

  // Rychlé předvolby helem
  const HELMET_PRESETS = [
    { label: 'Aero Road', value: 'POC Ventral / Specialized Evade' },
    { label: 'Full TT Visor', value: 'Kask Bambino / Mistral' },
    { label: 'Sprint Aero', value: 'Giro Vanquish' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. Kalkulátor převodu a vývinu */}
      <div className="p-4 sm:p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-surface-darkBorder">
        <div className="flex items-center justify-between mb-4">
          <label className="text-[11px] uppercase font-bold text-slate-400">
            1. Pevný převod & Kliky (Fixed Gear Setup)
          </label>
          <span className="text-xs font-black text-orange-500 font-mono">
            {gearRatio} : 1 ({gearInches}")
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Převodník (Chainring)
            </label>
            <input
              type="number"
              min="40"
              max="72"
              value={formData.chainring || 58}
              onChange={(e) => setFormData((prev) => ({ ...prev, chainring: parseInt(e.target.value) || 0 }))}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Pastorek (Cog)
            </label>
            <input
              type="number"
              min="11"
              max="20"
              value={formData.cog || 14}
              onChange={(e) => setFormData((prev) => ({ ...prev, cog: parseInt(e.target.value) || 0 }))}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Kliky (mm)
            </label>
            <input
              type="number"
              step="2.5"
              value={formData.crank_length_mm || 165.0}
              onChange={(e) => setFormData((prev) => ({ ...prev, crank_length_mm: parseFloat(e.target.value) || 165.0 }))}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Telemetrické shrnutí převodu */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800 text-center">
          <div>
            <div className="text-[9px] uppercase font-bold text-slate-400">Převodový poměr</div>
            <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{gearRatio}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase font-bold text-slate-400">Gear Inches</div>
            <div className="text-sm font-extrabold text-orange-500">{gearInches}"</div>
          </div>
          <div>
            <div className="text-[9px] uppercase font-bold text-slate-400">Vývin na 1 otáčku</div>
            <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{developmentMeters} m</div>
          </div>
        </div>
      </div>

      {/* 2. Rám / Kolo */}
      <div>
        <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1.5">
          2. Závodní stroj (Bike Model)
        </label>
        <input
          type="text"
          value={formData.bike_model || ''}
          placeholder="např. Look T20, Argon18 Electron Pro, Dolan DF4"
          onChange={(e) => setFormData((prev) => ({ ...prev, bike_model: e.target.value }))}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
        />
      </div>

      {/* 3. Kokpit / Řídítka */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] uppercase font-bold text-slate-400">
            3. Řídítka & Kokpit
          </label>
          <div className="flex gap-1">
            {HANDLEBAR_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, handlebar_setup: preset.value }))}
                className="text-[10px] py-0.5 px-2 rounded bg-slate-100 dark:bg-slate-800 hover:bg-orange-500/10 hover:text-orange-500 text-slate-500 dark:text-slate-400 font-semibold transition"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <input
          type="text"
          value={formData.handlebar_setup || ''}
          placeholder="např. Vision Metron 4 Track, WattShop Anemoi"
          onChange={(e) => setFormData((prev) => ({ ...prev, handlebar_setup: e.target.value }))}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
        />
      </div>

      {/* 4. Přilba (Helma) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] uppercase font-bold text-slate-400">
            4. Přilba (Aero Helmet)
          </label>
          <div className="flex gap-1">
            {HELMET_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, helmet: preset.value }))}
                className="text-[10px] py-0.5 px-2 rounded bg-slate-100 dark:bg-slate-800 hover:bg-orange-500/10 hover:text-orange-500 text-slate-500 dark:text-slate-400 font-semibold transition"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <input
          type="text"
          value={formData.helmet || ''}
          placeholder="např. POC Ventral Air, Kask Mistral, Giro Aerohead"
          onChange={(e) => setFormData((prev) => ({ ...prev, helmet: e.target.value }))}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-500 font-semibold"
        />
      </div>
    </div>
  )
}