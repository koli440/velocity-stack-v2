'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { heroCardContent } from '../lib/heroCard'

// Feed hero visual: the activity's own power over elapsed time as a rectangular area chart,
// or a distance / time / speed summary when the activity has no power data.
export default function HeroCardVisual({ activity, className = '' }) {
  const content = heroCardContent(activity)

  if (content.kind === 'power') {
    const last = content.data[content.data.length - 1]
    return (
      <div className={className} role="img" aria-label="Power over time chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={content.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="heroPowerFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a855f7" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#a855f7" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, last.t || 1]}
              tickCount={4}
              tickFormatter={(t) => (t >= 3600 ? `${(t / 3600).toFixed(1)}h` : `${Math.round(t / 60)}m`)}
              tick={{ fontSize: 9, fill: '#cbd5e1' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis width={32} tick={{ fontSize: 9, fill: '#cbd5e1' }} tickLine={false} axisLine={false} tickCount={4} />
            <Area type="monotone" dataKey="power" stroke="#a855f7" strokeWidth={2} fill="url(#heroPowerFill)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-around gap-2 text-white ${className}`}>
      {content.items.map((m) => (
        <div key={m.key} className="text-center">
          <b className="block text-2xl font-black tracking-tight">{m.value}</b>
          <span className="text-[10px] uppercase tracking-widest font-bold text-slate-300">{m.unit}</span>
        </div>
      ))}
    </div>
  )
}
