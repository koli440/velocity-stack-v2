'use client'

import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts'
import ChartTooltip from '@/components/ChartTooltip'
import { TOOLTIP_CURSOR_LINE } from '@/lib/chartTooltip'
import { FITNESS_COLORS } from '@/components/FitnessChart'

const grid = '#334155'
const axis = { fill: '#94a3b8', fontSize: 11, fontWeight: 600 }
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Planned vs actual fitness (CTL) to the race, plus the forecast form (TSB). All lines past today are estimates. */
export function ProjectionChart({ rows, raceDate, label }) {
  return (
    <div role="img" aria-label={label} className="w-full h-72 sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} opacity={0.2} />
          <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={{ stroke: '#cbd5e1', opacity: 0.6 }} tick={axis} minTickGap={32} />
          <YAxis tickLine={false} axisLine={false} tick={axis} domain={['auto', 'auto']} width={40} />
          <Tooltip cursor={TOOLTIP_CURSOR_LINE} content={<ChartTooltip labelFormatter={(l) => shortDay(l)} />} />
          <ReferenceLine y={0} stroke="#94a3b8" opacity={0.5} />
          {raceDate && <ReferenceLine x={raceDate} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={2} />}
          <Line type="monotone" dataKey="planCtl" stroke="#94a3b8" strokeWidth={2} strokeDasharray="2 4" dot={false} isAnimationActive={false} name="Planned fitness" />
          <Line type="monotone" dataKey="forecastCtl" stroke={FITNESS_COLORS.fitness} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} name="Forecast fitness" />
          <Line type="monotone" dataKey="forecastForm" stroke={FITNESS_COLORS.form} strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} name="Forecast form" />
          <Line type="monotone" dataKey="actualCtl" stroke={FITNESS_COLORS.fitness} strokeWidth={3} dot={false} isAnimationActive={false} name="Actual fitness" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const KIND_FILL = { build: '#3b82f6', recovery: '#10b981', taper: '#f59e0b' }

/** Weekly target TL bars coloured by week kind (the athlete's timeline and the coach's overview). */
export function WeeklyTargetChart({ weeks, actual = {}, label }) {
  const data = weeks.map((w) => ({ week: w.week_start, kind: w.kind, target: w.target_tl, actual: actual[w.week_start] ?? undefined }))
  return (
    <div role="img" aria-label={label} className="w-full h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} opacity={0.2} />
          <XAxis dataKey="week" tickFormatter={shortDay} tickLine={false} axisLine={{ stroke: '#cbd5e1', opacity: 0.6 }} tick={axis} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} tick={axis} width={40} />
          <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={<ChartTooltip labelFormatter={(l) => `Week of ${shortDay(l)}`} />} />
          <Bar dataKey="target" isAnimationActive={false} name="Target TL" fill="#3b82f6" shape={(p) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={3} fill={KIND_FILL[p.kind] || '#3b82f6'} />} />
          <Line type="monotone" dataKey="actual" stroke="#e2e8f0" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} name="Actual TL" connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
