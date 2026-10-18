'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { heroCardContent } from '../lib/heroCard'

// Feed hero visual: per-activity power curve as a rectangular area chart,
// or a distance / time / speed summary when the activity has no power data.
export default function HeroCardVisual({ activity, className = '' }) {
  const content = heroCardContent(activity)

  if (content.kind === 'profile') {
    return (
      <div className={className} role="img" aria-label="Power curve chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={content.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#cbd5e1' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis width={32} tick={{ fontSize: 9, fill: '#cbd5e1' }} tickLine={false} axisLine={false} unit="W" />
            <Area type="monotone" dataKey="power" stroke="#a855f7" strokeWidth={2} fill="#a855f7" fillOpacity={0.4} connectNulls dot={{ r: 2, fill: '#a855f7' }} isAnimationActive={false} />
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
