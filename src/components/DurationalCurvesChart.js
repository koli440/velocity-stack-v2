'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

// Správné chronologické pořadí od nejkratšího sprintu po hodinovou vytrvalost
const DURATION_ORDER = [
  '1s', '5s', '10s', '15s', '30s',
  '1m', '2m', '3m', '5m', '10m',
  '20m', '30m', '1h',
]

const METRICS = [
  { key: 'Cadence', label: 'Cadence', unit: 'RPM', color: '#f97316' },
  { key: 'Speed', label: 'Speed', unit: 'km/h', color: '#38bdf8' },
  { key: 'Power', label: 'Power', unit: 'W', color: '#a855f7' },
  { key: 'Torque', label: 'Torque', unit: 'Nm', color: '#eab308' },
  { key: 'HeartRate', label: 'HeartRate', unit: 'BPM', color: '#ef4444' },
]

export default function DurationalCurvesChart({ curves = {} }) {
  const [activeMetric, setActiveMetric] = useState('Cadence')

  // Získání a seřazení dat pro aktivní metriku
  const activeCurveRaw = curves[activeMetric] || {}
  const currentMetricConfig = METRICS.find((m) => m.key === activeMetric) || METRICS[0]

  // Seřazení bodů výhradně podle DURATION_ORDER
  const chartData = DURATION_ORDER
    .filter((timeKey) => activeCurveRaw[timeKey] !== undefined && activeCurveRaw[timeKey] !== null)
    .map((timeKey) => ({
      duration: timeKey,
      value: Number(activeCurveRaw[timeKey]),
    }))

  return (
    <div className="w-full bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
      {/* Horní hlavička s výběrem metriky */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
          Durational Curves
        </h2>

        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
          {METRICS.map((metric) => {
            const isSelected = activeMetric === metric.key
            return (
              <button
                key={metric.key}
                type="button"
                onClick={() => setActiveMetric(metric.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  isSelected
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {metric.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Recharts Graf */}
      <div className="w-full h-72 sm:h-80">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#334155"
                opacity={0.2}
              />
              <XAxis
                dataKey="duration"
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1', opacity: 0.6 }}
                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const dataPoint = payload[0].payload
                    return (
                      <div className="bg-slate-900 text-white text-xs py-1.5 px-3 rounded-xl shadow-lg border border-slate-800">
                        <span className="font-bold text-slate-400 mr-2">{dataPoint.duration}:</span>
                        <span className="font-black" style={{ color: currentMetricConfig.color }}>
                          {dataPoint.value} {currentMetricConfig.unit}
                        </span>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={currentMetricConfig.color}
                strokeWidth={3}
                dot={{ fill: currentMetricConfig.color, r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: currentMetricConfig.color }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs font-semibold text-slate-400">
            Pro vybranou metriku ({activeMetric}) nejsou k dispozici žádná data.
          </div>
        )}
      </div>
    </div>
  )
}