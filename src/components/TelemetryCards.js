'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts'

const mockPowerData = [
  { s: 0, w: 300 },
  { s: 10, w: 450 },
  { s: 20, w: 900 },
  { s: 30, w: 1450 },
  { s: 40, w: 1200 },
  { s: 50, w: 750 },
  { s: 60, w: 600 },
  { s: 70, w: 500 },
  { s: 80, w: 420 },
]

export default function TelemetryCards({ lastActivity }) {
  const peakPower = lastActivity?.max_power_w || 1450
  const maxCadence = lastActivity?.max_cadence_rpm || 124

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* 1. Velodrome Lap Live Telemetry */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm flex flex-col justify-between">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Velodrome Lap</h3>
          <span className="text-xs text-slate-400 font-mono">Live telemetry • <strong className="text-emerald-500">Live</strong></span>
        </div>

        <div className="space-y-2 text-xs font-mono">
          <div className="flex justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-700 dark:text-slate-200">
            <span>Lap 1:</span> <span>23.4s</span>
          </div>
          <div className="flex justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-700 dark:text-slate-200">
            <span>Lap 2:</span> <span>23.6s</span>
          </div>
          <div className="flex justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-700 dark:text-slate-200">
            <span>Lap 3:</span> <span>23.8s</span>
          </div>
        </div>
      </div>

      {/* 2. Peak Power (Velký neonový/zelený indikátor s křivkou) */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
        <div className="flex justify-between items-start mb-1">
          <span className="text-xs uppercase font-bold text-slate-400">Peak Power</span>
          <span className="text-xs text-slate-400">Sprint</span>
        </div>
        <div className="text-4xl font-black text-emerald-500 dark:text-brand-neon tracking-tight">
          {peakPower}W
        </div>

        <div className="h-32 w-full mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockPowerData}>
              <defs>
                <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334155',
                  borderRadius: '0.75rem',
                  color: '#fff',
                }}
              />
              <Area
                type="monotone"
                dataKey="w"
                stroke="#10B981"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#powerGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. Average Cadence (Kruhový prvek s RPM) */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm flex items-center justify-between">
        <div>
          <span className="text-xs uppercase font-bold text-slate-400">Average Cadence</span>
          <div className="text-xs text-slate-500 mt-1">Consistent fixed-gear rhythm</div>
        </div>
        <div className="relative w-24 h-24 flex items-center justify-center rounded-full border-4 border-emerald-500/20 dark:border-brand-neon/20 border-t-emerald-500 dark:border-t-brand-neon">
          <div className="text-center">
            <span className="text-2xl font-black text-slate-900 dark:text-white leading-none block">
              {maxCadence}
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase">RPM</span>
          </div>
        </div>
      </div>

      {/* 4. Gym Strength Log (Silová příprava) */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-2">
        <span className="text-xs uppercase font-bold text-slate-400">Gym Strength Log</span>
        <div className="space-y-2 text-xs pt-1">
          <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-700 dark:text-slate-200">
            <span>Back Squats (5×5)</span>
            <span className="font-bold text-emerald-600 dark:text-brand-neon">@ 120kg</span>
          </div>
          <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 font-semibold text-slate-700 dark:text-slate-200">
            <span>Power Cleans (4×6)</span>
            <span className="font-bold text-emerald-600 dark:text-brand-neon">@ 80kg</span>
          </div>
        </div>
      </div>
    </div>
  )
}