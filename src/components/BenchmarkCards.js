'use client'

export default function BenchmarkCards({ currentActivity, masterCurves = {} }) {
  if (!currentActivity) return null

  // Srovnání pro klíčové sprintérské i vytrvalostní metriky
  const powerMaster5s = masterCurves.Power?.['5s'] || null
  const cadenceMaster1s = masterCurves.Cadence?.['1s'] || null
  const speedMaster5s = masterCurves.Speed?.['5s'] || null
  const torqueMaster1s = masterCurves.Torque?.['1s'] || null

  const getDeltaBadge = (current, master, unit) => {
    if (!current || !master) return null
    const pct = Math.round((current / master) * 100)
    const isPB = current >= master

    if (isPB) {
      return (
        <span className="text-[10px] font-black py-0.5 px-2 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          🏆 Nový All-time PB!
        </span>
      )
    }

    return (
      <span className="text-[10px] font-bold py-0.5 px-2 rounded bg-slate-100 dark:bg-slate-800 text-slate-400">
        {pct}% osobního maxima
      </span>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Peak Cadence Benchmark */}
      <div className="p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-slate-400">Cadence Peak</span>
          {getDeltaBadge(currentActivity.max_cadence_rpm, cadenceMaster1s, 'RPM')}
        </div>
        <div className="text-xl font-black text-orange-500">
          {currentActivity.max_cadence_rpm || '—'} <span className="text-xs font-bold text-slate-400">RPM</span>
        </div>
        <div className="text-[10px] text-slate-400">
          Historické maximum: <span className="font-bold text-slate-300">{cadenceMaster1s || '—'} RPM</span>
        </div>
      </div>

      {/* Max Power Benchmark */}
      <div className="p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-slate-400">Max Watts</span>
          {getDeltaBadge(currentActivity.max_power_w, powerMaster5s, 'W')}
        </div>
        <div className="text-xl font-black text-purple-400">
          {currentActivity.max_power_w || '—'} <span className="text-xs font-bold text-slate-400">W</span>
        </div>
        <div className="text-[10px] text-slate-400">
          Historické 5s maximum: <span className="font-bold text-slate-300">{powerMaster5s || '—'} W</span>
        </div>
      </div>

      {/* Peak Torque Benchmark */}
      <div className="p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-slate-400">Peak Torque</span>
          {getDeltaBadge(currentActivity.peak_torque_nm, torqueMaster1s, 'Nm')}
        </div>
        <div className="text-xl font-black text-amber-400">
          {currentActivity.peak_torque_nm || '—'} <span className="text-xs font-bold text-slate-400">Nm</span>
        </div>
        <div className="text-[10px] text-slate-400">
          Historický odpal z nuly: <span className="font-bold text-slate-300">{torqueMaster1s || '—'} Nm</span>
        </div>
      </div>

      {/* Max Speed Benchmark */}
      <div className="p-4 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-slate-400">Top Speed</span>
          {getDeltaBadge(currentActivity.max_speed_kmh, speedMaster5s, 'km/h')}
        </div>
        <div className="text-xl font-black text-sky-400">
          {currentActivity.max_speed_kmh || '—'} <span className="text-xs font-bold text-slate-400">km/h</span>
        </div>
        <div className="text-[10px] text-slate-400">
          Historický letmý peak: <span className="font-bold text-slate-300">{speedMaster5s || '—'} km/h</span>
        </div>
      </div>
    </div>
  )
}