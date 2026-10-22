'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'

export const FITNESS_COLORS = { fitness: '#3b82f6', fatigue: '#f43f5e', form: '#10b981' }

const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function FitnessTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-slate-900 text-white text-xs py-2 px-3 rounded-xl shadow-lg border border-slate-800 space-y-1">
      <div className="font-bold text-slate-400 border-b border-slate-800 pb-1">{shortDay(p.day)}</div>
      <div style={{ color: FITNESS_COLORS.fitness }}>Fitness: <b>{p.fitness}</b></div>
      <div style={{ color: FITNESS_COLORS.fatigue }}>Fatigue: <b>{p.fatigue}</b></div>
      <div style={{ color: FITNESS_COLORS.form }}>Form: <b>{p.form}</b></div>
      <div className="text-slate-300">
        Load: <b>{p.load}</b>
        {p.estimatedLoad > 0 && <span className="text-slate-400"> ({p.estimatedLoad} estimated from heart rate)</span>}
      </div>
      {p.races?.map((r) => (
        <div key={r.id} className="text-amber-300">Race: {r.name}</div>
      ))}
    </div>
  )
}

/**
 * Fitness / Fatigue / Form chart. `compact` is the dashboard mini chart (no axes, no bars).
 * Daily load bars: solid = measured (power) load, hatched/lighter = estimated from heart rate.
 */
export default function FitnessChart({ series, races = [], compact = false, label }) {
  const raceDays = new Set(races.map((r) => r.race_date))
  const data = series.map((p) => ({
    ...p,
    measuredLoad: Math.max(0, p.load - p.estimatedLoad),
    races: races.filter((r) => r.race_date === p.day),
  }))
  const grid = '#334155'
  const axis = { fill: '#94a3b8', fontSize: 11, fontWeight: 600 }

  return (
    <div
      role="img"
      aria-label={label}
      className={compact ? 'w-full h-28' : 'w-full h-72 sm:h-96'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: compact ? 0 : -16, bottom: 0 }}>
          <defs>
            <pattern id="fitness-est-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#94a3b8" fillOpacity="0.25" />
              <rect width="2.5" height="6" fill="#94a3b8" fillOpacity="0.8" />
            </pattern>
          </defs>
          {!compact && <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} opacity={0.2} />}
          <XAxis
            dataKey="day"
            hide={compact}
            tickFormatter={shortDay}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1', opacity: 0.6 }}
            tick={axis}
            minTickGap={32}
          />
          <YAxis hide={compact} tickLine={false} axisLine={false} tick={axis} domain={['auto', 'auto']} width={40} />
          <Tooltip content={<FitnessTooltip />} />
          {!compact && <ReferenceLine y={0} stroke="#94a3b8" opacity={0.5} />}
          {!compact && (
            <Bar dataKey="measuredLoad" stackId="load" fill="#94a3b8" fillOpacity={0.35} isAnimationActive={false} name="Load" />
          )}
          {!compact && (
            <Bar dataKey="estimatedLoad" stackId="load" fill="url(#fitness-est-hatch)" isAnimationActive={false} name="Estimated load" />
          )}
          {!compact &&
            data
              .filter((p) => raceDays.has(p.day))
              .map((p) => (
                <ReferenceLine key={p.day} x={p.day} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={2} />
              ))}
          <Line type="monotone" dataKey="fitness" stroke={FITNESS_COLORS.fitness} strokeWidth={compact ? 2 : 3} dot={false} isAnimationActive={false} name="Fitness" />
          <Line type="monotone" dataKey="fatigue" stroke={FITNESS_COLORS.fatigue} strokeWidth={compact ? 1.5 : 2} dot={false} isAnimationActive={false} name="Fatigue" />
          <Line type="monotone" dataKey="form" stroke={FITNESS_COLORS.form} strokeWidth={compact ? 1.5 : 2} dot={false} isAnimationActive={false} name="Form" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
