'use client'

// Activity stream graphs (issue #12): speed, heart rate, power, cadence and torque, each in its
// own compact lane, stacked vertically and aligned on a shared X axis that can be switched
// between elapsed time and distance.

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { STREAM_METRICS, buildStreamSeries, formatAxisTick, formatElapsed } from '../lib/activityStreams'

function MetricLane({ metric, data, mode, syncId }) {
  const hasData = data.some((d) => d[metric.key] != null)
  if (!hasData) return null

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 text-right">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {metric.label}
        </div>
        <div className="text-[9px] text-slate-400">{metric.unit}</div>
      </div>
      <div className="h-12 flex-1 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId={syncId} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metric.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={metric.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* type="number" + explicit domain so points are placed by their real x value
                (seconds or meters), not evenly spaced by array index. Without this, Recharts
                falls back to a category axis and the time/distance switch has no visual effect:
                stationary stretches (repeated distance values) still take up as much horizontal
                space as they do in time mode. */}
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null
                const value = payload[0]?.value
                if (value == null) return null
                return (
                  <div className="bg-slate-900 text-white text-[10px] py-1.5 px-2.5 rounded-lg shadow-lg border border-slate-800 whitespace-nowrap">
                    <span className="text-slate-400">{formatAxisTick(label, mode)} · </span>
                    <span className="font-black" style={{ color: metric.color }}>
                      {metric.decimals > 0 ? value.toFixed(metric.decimals) : Math.round(value)} {metric.unit}
                    </span>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey={metric.key}
              stroke={metric.color}
              strokeWidth={1.5}
              fill={`url(#fill-${metric.key})`}
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function ActivityStreamsChart({ timeSeries = {} }) {
  const [mode, setMode] = useState('time')

  const data = useMemo(() => buildStreamSeries(timeSeries, mode), [timeSeries, mode])
  const hasAnyData = data.length > 0

  if (!hasAnyData) return null

  const lastPoint = data[data.length - 1]

  return (
    <div className="w-full bg-white dark:bg-surface-darkCard p-4 sm:p-5 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Activity Graph
          </h2>
          <p className="text-[10px] text-slate-400">
            {mode === 'time' ? `Elapsed ${formatElapsed(lastPoint.x)}` : `Distance ${(lastPoint.x / 1000).toFixed(2)} km`}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
          {[
            { key: 'time', label: 'Time' },
            { key: 'distance', label: 'Distance' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                mode === opt.key
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {STREAM_METRICS.map((metric) => (
          <MetricLane key={metric.key} metric={metric} data={data} mode={mode} syncId="activity-streams" />
        ))}
      </div>

      <div className="mt-2 pl-[4.75rem] flex justify-between text-[9px] font-semibold text-slate-400">
        <span>{mode === 'time' ? '0:00' : '0 km'}</span>
        <span>{mode === 'time' ? formatElapsed(lastPoint.x) : `${(lastPoint.x / 1000).toFixed(1)} km`}</span>
      </div>
    </div>
  )
}
