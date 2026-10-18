'use client'

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { heroCardContent } from '../lib/heroCard'

// Feed hero visual: per-activity power profile radar (same look as PowerProfileCard),
// or a distance / time / speed summary when the activity has no power data.
export default function HeroCardVisual({ activity, className = '' }) {
  const content = heroCardContent(activity)

  if (content.kind === 'profile') {
    return (
      <div className={className} role="img" aria-label="Power profile radar chart">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={content.data} outerRadius="65%">
            <PolarGrid stroke="#94a3b8" strokeOpacity={0.4} />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: '#cbd5e1' }} />
            <Radar dataKey="power" stroke="#a855f7" fill="#a855f7" fillOpacity={0.45} isAnimationActive={false} />
          </RadarChart>
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
