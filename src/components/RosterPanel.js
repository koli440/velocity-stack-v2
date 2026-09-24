'use client'

export default function RosterPanel() {
  const riders = [
    { name: 'Jan M.', status: 'Training on Track', state: 'track' },
    { name: 'Petr K.', status: 'Training on Track', state: 'track' },
    { name: 'Kam J.', status: 'In Gym', state: 'gym' },
    { name: 'Jonir J.', status: 'Training on Track', state: 'track' },
    { name: 'Ranon X.', status: 'In Gym', state: 'gym' },
  ]

  return (
    <aside className="w-80 shrink-0 space-y-6">
      {/* Tlačítko pro přidání tréninku */}
      <button className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-sm shadow-md transition">
        + Add Workout / Session
      </button>

      {/* Roster & Activity */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Active Riders</h3>
          <span className="text-xs text-slate-400">•••</span>
        </div>

        <div className="space-y-3">
          {riders.map((r, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">
                  {r.name.slice(0, 2)}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                    {r.name}
                  </div>
                  <div className="text-[11px] text-slate-400">{r.status}</div>
                </div>
              </div>
              <span
                className={`w-2 h-2 rounded-full ${
                  r.state === 'track'
                    ? 'bg-emerald-500 dark:bg-brand-neon animate-pulse'
                    : 'bg-amber-400'
                }`}
              ></span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Stats & Hydration */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm">Quick Stats & Hydration</h3>
        
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-lg">💧</span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">Hydration</div>
            <div className="text-[11px] text-emerald-500 font-semibold">Optimal</div>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-lg">⚡</span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">Fatigue</div>
            <div className="text-[11px] text-slate-400">Low (12%)</div>
          </div>
        </div>
      </div>
    </aside>
  )
}