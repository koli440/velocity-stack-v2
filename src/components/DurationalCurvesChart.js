'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
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
import { BASELINE_PERIOD_LABELS, BASELINE_PERIODS } from '../lib/baselineCurves'

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

// "All-time" goes through the same period-scoped baseline RPC as every other option
// (no lower date bound), so it benefits from identical per-point activity attribution.
const ALL_TIME = BASELINE_PERIODS.ALL_TIME

const PERIOD_OPTIONS = [
  { key: ALL_TIME, label: 'All-time' },
  { key: BASELINE_PERIODS.LAST_30_DAYS, label: BASELINE_PERIOD_LABELS[BASELINE_PERIODS.LAST_30_DAYS] },
  { key: BASELINE_PERIODS.LAST_90_DAYS, label: BASELINE_PERIOD_LABELS[BASELINE_PERIODS.LAST_90_DAYS] },
  { key: BASELINE_PERIODS.CALENDAR_YEAR, label: BASELINE_PERIOD_LABELS[BASELINE_PERIODS.CALENDAR_YEAR] },
  { key: BASELINE_PERIODS.ROLLING_YEAR, label: BASELINE_PERIOD_LABELS[BASELINE_PERIODS.ROLLING_YEAR] },
  { key: BASELINE_PERIODS.CUSTOM, label: BASELINE_PERIOD_LABELS[BASELINE_PERIODS.CUSTOM] },
]

export default function DurationalCurvesChart({
  curves = {},
  masterCurves = null, // Legacy all-time Master curve (kept for the "All-time" option)
  baselineCurves = null, // { period, start, end, curves: { [metric]: { [durationKey]: { value, activityId, activityTitle, activityDate } } } }
  baselineLoading = false,
  onPeriodChange, // (period: string, customRange?: { start: string, end: string }) => void
}) {
  const [activeMetric, setActiveMetric] = useState('Cadence')
  const [showBaseline, setShowBaseline] = useState(true)
  const [period, setPeriod] = useState(ALL_TIME)
  const [customRange, setCustomRange] = useState({ start: '', end: '' })

  const activeCurveRaw = curves[activeMetric] || {}
  const currentMetricConfig = METRICS.find((m) => m.key === activeMetric) || METRICS[0]

  const isCustomPeriod = period === BASELINE_PERIODS.CUSTOM
  const isAllTime = period === ALL_TIME

  const handlePeriodChange = (nextPeriod) => {
    setPeriod(nextPeriod)
    if (!onPeriodChange) return
    if (nextPeriod === BASELINE_PERIODS.CUSTOM) {
      if (customRange.start && customRange.end) {
        onPeriodChange(nextPeriod, customRange)
      }
      return
    }
    onPeriodChange(nextPeriod)
  }

  const handleCustomRangeChange = (field, value) => {
    const next = { ...customRange, [field]: value }
    setCustomRange(next)
    if (onPeriodChange && next.start && next.end) {
      onPeriodChange(BASELINE_PERIODS.CUSTOM, next)
    }
  }

  // Prefer the period-scoped baseline (which carries per-point activity attribution) for
  // every period, including "All-time". The legacy plain-number masterCurves prop is only
  // used as a fallback for callers that don't wire up onPeriodChange/baselineCurves at all.
  const baselinePoints = useMemo(() => {
    if (baselineCurves && baselineCurves.curves) {
      return baselineCurves.curves[activeMetric] || {}
    }
    if (isAllTime) {
      const masterCurveRaw = (masterCurves && masterCurves[activeMetric]) || {}
      return Object.fromEntries(
        Object.entries(masterCurveRaw)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([durationKey, value]) => [durationKey, { value: Number(value) }])
      )
    }
    return {}
  }, [baselineCurves, isAllTime, masterCurves, activeMetric])

  const baselineLabel = PERIOD_OPTIONS.find((p) => p.key === period)?.label || 'Baseline'

  // Build the chart data: combines the current ride and the selected baseline period
  const chartData = DURATION_ORDER
    .filter((timeKey) => {
      const hasCurrent = activeCurveRaw[timeKey] !== undefined && activeCurveRaw[timeKey] !== null
      const hasBaseline = baselinePoints[timeKey] !== undefined && baselinePoints[timeKey] !== null
      return hasCurrent || hasBaseline
    })
    .map((timeKey) => {
      const baselinePoint = baselinePoints[timeKey]
      return {
        duration: timeKey,
        current: activeCurveRaw[timeKey] !== undefined ? Number(activeCurveRaw[timeKey]) : null,
        baseline: baselinePoint ? baselinePoint.value : null,
        baselineActivityId: baselinePoint?.activityId ?? null,
        baselineActivityTitle: baselinePoint?.activityTitle ?? null,
      }
    })

  return (
    <div className="w-full bg-white dark:bg-surface-darkCard p-6 rounded-3xl border border-slate-200 dark:border-surface-darkBorder shadow-xs">
      {/* Top bar with tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Durational Curves & Baseline
          </h2>
          <p className="text-[10px] text-slate-400">
            Comparison of the current ride against your best curve ({baselineLabel.toLowerCase()})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(masterCurves || baselineCurves || onPeriodChange) && (
            <button
              type="button"
              onClick={() => setShowBaseline(!showBaseline)}
              className={`px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition ${
                showBaseline
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-transparent'
                  : 'bg-transparent text-slate-400 border-slate-200 dark:border-slate-800'
              }`}
            >
              {showBaseline ? `✓ ${baselineLabel} enabled` : `+ Show ${baselineLabel}`}
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

      {/* Baseline period selector (issue #28): 30/90 days, this calendar year, last
          floating year, or a custom day-picker range. Only shown when the parent wires
          up onPeriodChange (i.e. supports fetching period-scoped baseline curves). */}
      {onPeriodChange && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => handlePeriodChange(option.key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                  period === option.key
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {isCustomPeriod && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => handleCustomRangeChange('start', e.target.value)}
                className="px-2 py-1 text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
              />
              <span className="text-[10px] text-slate-400">to</span>
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => handleCustomRangeChange('end', e.target.value)}
                className="px-2 py-1 text-[10px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
              />
            </div>
          )}

          {baselineLoading && (
            <span className="text-[10px] font-semibold text-slate-400">Loading baseline…</span>
          )}
        </div>
      )}

      {/* Chart */}
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
                            <span className="text-slate-300">This ride:</span>
                            <span className="font-black" style={{ color: currentMetricConfig.color }}>
                              {dataPoint.current} {currentMetricConfig.unit}
                            </span>
                          </div>
                        )}
                        {showBaseline && dataPoint.baseline != null && (
                          <div className="flex items-center justify-between gap-4 text-slate-400">
                            <span>{baselineLabel}:</span>
                            <span className="font-bold text-slate-200">
                              {dataPoint.baseline} {currentMetricConfig.unit}
                            </span>
                          </div>
                        )}
                        {showBaseline && dataPoint.baseline != null && dataPoint.baselineActivityId && (
                          <div className="pt-1 border-t border-slate-800">
                            <Link
                              href={`/activities/${dataPoint.baselineActivityId}`}
                              className="text-[10px] font-bold text-orange-400 hover:text-orange-300 underline"
                            >
                              View activity{dataPoint.baselineActivityTitle ? `: ${dataPoint.baselineActivityTitle}` : ''}
                            </Link>
                          </div>
                        )}
                      </div>
                    )
                  }
                  return null
                }}
              />

              {/* Reference line: selected baseline period (dashed) */}
              {showBaseline && (
                <Line
                  type="monotone"
                  dataKey="baseline"
                  stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  name={baselineLabel}
                />
              )}

              {/* Current ride (solid color) */}
              <Line
                type="monotone"
                dataKey="current"
                stroke={currentMetricConfig.color}
                strokeWidth={3}
                dot={{ fill: currentMetricConfig.color, r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: currentMetricConfig.color }}
                name="This ride"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs font-semibold text-slate-400">
            No data is available for the selected metric ({activeMetric}).
          </div>
        )}
      </div>
    </div>
  )
}
