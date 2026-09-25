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
  Legend,
} from 'recharts'

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

export default function DurationalCurvesChart({
  curves = {},
  masterCurves = null, // Volitelná Master křivka pro srovnání
}) {
  const [activeMetric, setActiveMetric] = useState('Cadence')
  const [showMaster, setShowMaster] = useState(true)

  const activeCurveRaw = curves[activeMetric] || {}
  const masterCurveRaw = (masterCurves && masterCurves[activeMetric]) || {}
  const currentMetricConfig = METRICS.find((m) => m.key === activeMetric) || METRICS[0]

  // Sestavení dat pro graf: propojí aktuální jízdu i Master profil
  const chartData = DURATION_ORDER
    .filter((timeKey) => {
      const hasCurrent = activeCurveRaw[timeKey] !== undefined && activeCurveRaw[timeKey] !== null
      const hasMaster = masterCurveRaw[timeKey] !== undefined && masterCurveRaw[timeKey] !== null
      return hasCurrent || hasMaster
    })
    .map((timeKey) => ({
      duration: timeKey,
      current: activeCurveRaw[timeKey] !== undefined ? Number(activeCurveRaw[timeKey]) : null,
      master: masterCurveRaw[timeKey] !== undefined ? Number(masterCurveRaw[timeKey]) : null,
    }))

  return (
    <div className="w-full bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
      {/* Horní lišta s taby */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Durational Curves & Benchmark
          </h2>
          <p className="text-[10px] text-slate-400">
            Srovnání aktuální jízdy proti osobnímu maximu (Master Best)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {masterCurves && (
            <button
              type="button"
              onClick={() => setShowMaster(!showMaster)}
              className={`px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition ${
                showMaster
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent'
                  : 'bg-transparent text-slate-400 border-slate-200 dark:border-slate-800'
              }`}
            >
              {showMaster ? '✓ All-time PB zapnuto' : '+ Zobrazit All-time PB'}
            </button>
          )}

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
      </div>

      {/* Graf */}
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
                      <div className="bg-slate-900 text-white text-xs py-2 px-3 rounded-xl shadow-lg border border-slate-800 space-y-1">
                        <div className="font-bold text-slate-400 border-b border-slate-800 pb-1">
                          Interval: {dataPoint.duration}
                        </div>
                        {dataPoint.current != null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Tato jízda:</span>
                            <span className="font-black" style={{ color: currentMetricConfig.color }}>
                              {dataPoint.current} {currentMetricConfig.unit}
                            </span>
                          </div>
                        )}
                        {showMaster && dataPoint.master != null && (
                          <div className="flex items-center justify-between gap-4 text-slate-400">
                            <span>All-time PB:</span>
                            <span className="font-bold text-slate-200">
                              {dataPoint.master} {currentMetricConfig.unit}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  }
                  return null
                }}
              />

              {/* Referenční čára: Master Best (čárkovaná) */}
              {showMaster && (
                <Line
                  type="monotone"
                  dataKey="master"
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  name="All-time PB"
                />
              )}

              {/* Aktuální jízda (plná barva) */}
              <Line
                type="monotone"
                dataKey="current"
                stroke={currentMetricConfig.color}
                strokeWidth={3}
                dot={{ fill: currentMetricConfig.color, r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: currentMetricConfig.color }}
                name="Tato jízda"
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