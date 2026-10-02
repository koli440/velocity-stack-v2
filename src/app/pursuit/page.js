'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import {
  DISCIPLINES,
  getTrackLaps,
  calculatePursuitStrategy,
  formatTime,
  pacingStrategyLabel,
} from '../../lib/pursuit'

// Sorted, de-duplicated discipline categories (Endurance, Pursuit, Sprint). v1 defaulted the
// category picker to index 1 of its alphabetically-sorted list, which lands on "Pursuit" here too.
const CATEGORIES = Array.from(new Set(DISCIPLINES.map((d) => d.category))).sort()

const STRATEGY_BANNER = {
  negative: {
    className:
      'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
    label: 'Strategy: NEGATIVE SPLIT',
    detail: 'Start in control and increase tempo in the second half.',
  },
  positive: {
    className: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
    label: 'Strategy: POSITIVE SPLIT',
    detail: 'Aggressive start - watch out for your legs late on.',
  },
  even: {
    className: 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-400',
    label: 'Strategy: EVEN SPLIT',
    detail: 'Hold metronome tempo like a perfect machine.',
  },
}

// "Pursuit Strategist" - migrated from v1's pages/10_pursuit.py. Account-free (v1 never gated
// this page behind check_access, unlike PB Vault/Aero Lab), so no login is required here either.
export default function PursuitPage() {
  const [tracks, setTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(true)

  const [country, setCountry] = useState('')
  const [trackId, setTrackId] = useState('')
  const [category, setCategory] = useState('')
  const [disciplineName, setDisciplineName] = useState('')

  const [targetMin, setTargetMin] = useState(3)
  const [targetSec, setTargetSec] = useState(30)
  const [startPenalty, setStartPenalty] = useState(5)
  const [pacingDrift, setPacingDrift] = useState(0)
  const [chainring, setChainring] = useState(58)
  const [cog, setCog] = useState(15)

  useEffect(() => {
    let active = true
    supabase
      .from('tracks')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!active) return
        if (!error && data) setTracks(data)
        setLoadingTracks(false)
      })
    return () => {
      active = false
    }
  }, [])

  const countries = useMemo(
    () => Array.from(new Set(tracks.map((t) => t.country_code).filter(Boolean))).sort(),
    [tracks]
  )

  useEffect(() => {
    if (!country && countries.length > 0) setCountry(countries[0])
  }, [countries, country])

  const filteredTracks = useMemo(
    () => tracks.filter((t) => t.country_code === country),
    [tracks, country]
  )

  useEffect(() => {
    if (filteredTracks.length > 0 && !filteredTracks.some((t) => t.id === trackId)) {
      setTrackId(filteredTracks[0].id)
    }
  }, [filteredTracks, trackId])

  useEffect(() => {
    if (!category) setCategory(CATEGORIES[1] || CATEGORIES[0])
  }, [category])

  const filteredDisciplines = useMemo(
    () => DISCIPLINES.filter((d) => d.category === category),
    [category]
  )

  useEffect(() => {
    if (
      filteredDisciplines.length > 0 &&
      !filteredDisciplines.some((d) => d.name === disciplineName)
    ) {
      setDisciplineName(filteredDisciplines[0].name)
    }
  }, [filteredDisciplines, disciplineName])

  const selectedTrack = tracks.find((t) => t.id === trackId) || null
  const selectedDiscipline = DISCIPLINES.find((d) => d.name === disciplineName) || null
  const trackLengthM = selectedTrack ? Number(selectedTrack.length_m) : 0
  const targetSeconds = (Number(targetMin) || 0) * 60 + (Number(targetSec) || 0)

  const lapsInfo =
    selectedTrack && selectedDiscipline
      ? getTrackLaps(trackLengthM, selectedDiscipline.distanceM)
      : { laps: 0, valid: false }

  const strategy =
    lapsInfo.valid && lapsInfo.laps > 1 && selectedTrack && selectedDiscipline && targetSeconds > 0
      ? calculatePursuitStrategy({
          trackLengthM,
          laps: lapsInfo.laps,
          totalDistanceM: selectedDiscipline.distanceM,
          targetSeconds,
          startPenaltyS: Number(startPenalty) || 0,
          pacingDriftS: Number(pacingDrift) || 0,
          chainring: Number(chainring) || 1,
          cog: Number(cog) || 1,
        })
      : null

  const strategyLabel = pacingStrategyLabel(Number(pacingDrift) || 0)
  const banner = STRATEGY_BANNER[strategyLabel]

  const chartData = strategy
    ? strategy.laps.map((l) => ({
        lap: l.lap,
        speedKmh: l.speedKmh,
        cadenceRpm: l.cadenceRpm,
        overallTimeS: l.overallTimeS,
      }))
    : []

  const field = (label, value, onChange, { min, max, step = 1 } = {}) => (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
      />
    </label>
  )

  const select = (label, value, onChange, options) => (
    <label className="block space-y-1.5">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )

  const metric = (label, value, unit) => (
    <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <div className="text-2xl sm:text-3xl font-black text-emerald-500 dark:text-brand-neon tracking-tight mt-1">
        {value}
        {unit && <span className="text-base font-bold text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
          ⏱️ Pursuit Strategist
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tempo optimization: lock in a target time and work out the lap-by-lap pacing plan.
        </p>
      </div>

      {/* Event settings */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
        <h2 className="text-xs uppercase font-bold text-slate-400">Event Settings</h2>

        {loadingTracks ? (
          <div className="py-6 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            Loading Track Database...
          </div>
        ) : tracks.length === 0 ? (
          <div className="py-6 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            No tracks found in the database.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {select(
                'Country',
                country,
                setCountry,
                countries.map((c) => ({ value: c, label: c }))
              )}
              {select(
                'Track',
                trackId,
                setTrackId,
                filteredTracks.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.length_m}m, ${t.surface})`,
                }))
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {select(
                'Category',
                category,
                setCategory,
                CATEGORIES.map((c) => ({ value: c, label: c }))
              )}
              {select(
                'Discipline',
                disciplineName,
                setDisciplineName,
                filteredDisciplines.map((d) => ({ value: d.name, label: d.name }))
              )}
            </div>

            {selectedDiscipline && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Distance: <span className="font-bold">{selectedDiscipline.distanceM}m</span> | Total
                Laps:{' '}
                <span className="font-bold">
                  {lapsInfo.valid ? lapsInfo.laps : '—'}
                </span>
                {!lapsInfo.valid && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {' '}
                    (distance doesn&apos;t cleanly divide this track&apos;s length)
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {/* Target time */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
        <h2 className="text-xs uppercase font-bold text-slate-400">Target Time</h2>
        <div className="grid grid-cols-2 gap-4 max-w-xs">
          {field('Min', targetMin, setTargetMin, { min: 0, max: 60, step: 1 })}
          {field('Sec', targetSec, setTargetSec, { min: 0, max: 59.9, step: 0.1 })}
        </div>
      </div>

      {/* Pacing + gear */}
      <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-5">
        <div>
          <h2 className="text-xs uppercase font-bold text-slate-400 mb-3">Pacing Parameters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Standing start penalization: <span className="font-bold">{startPenalty}s</span>
              </span>
              <input
                type="range"
                min={0}
                max={7}
                step={0.1}
                value={startPenalty}
                onChange={(e) => setStartPenalty(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Pacing strategy (drift): <span className="font-bold">{pacingDrift}s/lap</span>
              </span>
              <input
                type="range"
                min={-0.75}
                max={0.75}
                step={0.01}
                value={pacingDrift}
                onChange={(e) => setPacingDrift(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <span className="text-[11px] text-slate-400">
                Negative = negative split (speed up), positive = positive split (slow down)
              </span>
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-xs uppercase font-bold text-slate-400 mb-3">Gear</h2>
          <div className="grid grid-cols-2 gap-4 max-w-xs">
            {field('Chainring', chainring, setChainring, { min: 32, max: 70, step: 1 })}
            {field('Cog', cog, setCog, { min: 10, max: 19, step: 1 })}
          </div>
        </div>
      </div>

      {!strategy ? (
        <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm text-sm text-slate-500 dark:text-slate-400">
          {tracks.length === 0
            ? 'Add a track to the database to use the strategist.'
            : 'Distance must be longer than 1 lap and must cleanly divide the selected track to compute a strategy.'}
        </div>
      ) : (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {metric('Distance', `${selectedDiscipline.distanceM}`, 'm')}
            {metric('Track', `${trackLengthM}`, 'm')}
            {metric('Target', formatTime(targetSeconds))}
            {metric('Avg Speed', strategy.avgSpeedKmh.toFixed(2), 'km/h')}
            {metric('Laps', `${lapsInfo.laps}x`)}
            {metric('Gear', `${chainring}x${cog}`)}
            {metric('Avg Cadence', strategy.avgCadenceRpm.toFixed(0), 'RPM')}
            {metric('Avg Lap Time', strategy.avgLapTimeS.toFixed(3), 's')}
          </div>

          {/* Strategy banner */}
          <div className={`p-4 rounded-2xl border text-sm font-semibold ${banner.className}`}>
            <div className="font-bold">{banner.label}</div>
            <div className="text-xs opacity-90 mt-0.5">{banner.detail}</div>
          </div>

          {/* Splits table */}
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm overflow-x-auto">
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3">📋 Splits</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-surface-darkBorder">
                  <th className="py-2 pr-4">Lap</th>
                  <th className="py-2 pr-4">Lap time (s)</th>
                  <th className="py-2 pr-4">Overall time</th>
                  <th className="py-2 pr-4">Speed (km/h)</th>
                  <th className="py-2 pr-4">Cadence (RPM)</th>
                </tr>
              </thead>
              <tbody>
                {strategy.laps.map((l) => (
                  <tr
                    key={l.lap}
                    className="border-b border-slate-100 dark:border-slate-800/60 text-slate-700 dark:text-slate-200"
                  >
                    <td className="py-1.5 pr-4 font-semibold">{l.lap}</td>
                    <td className="py-1.5 pr-4">{l.lapTimeS.toFixed(3)}</td>
                    <td className="py-1.5 pr-4">{l.overallTimeS.toFixed(3)}</td>
                    <td className="py-1.5 pr-4">{l.speedKmh.toFixed(1)}</td>
                    <td className="py-1.5 pr-4">{l.cadenceRpm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tempo analysis */}
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3">📈 Tempo Analysis</h2>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                  <XAxis
                    dataKey="lap"
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
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="speedKmh"
                    name="Speed (km/h)"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3">⚙️ Cadence (RPM)</h2>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                  <XAxis
                    dataKey="overallTimeS"
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
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="cadenceRpm"
                    name="Cadence (RPM)"
                    stroke="#ef4444"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Training notes */}
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-1">💡 Training Notes</h2>
            <p>
              1. <span className="font-bold">Standing start lap:</span> you need to rip it in{' '}
              <span className="font-bold">{strategy.firstLapTimeS}s</span>.
            </p>
            <p>
              2. <span className="font-bold">Flying laps:</span> average to hold{' '}
              <span className="font-bold">{strategy.avgFlyingLapTimeS.toFixed(2)}s</span>.
            </p>
            <p className="pt-2 border-t border-slate-100 dark:border-slate-800">
              Overall time: <span className="font-bold">{formatTime(strategy.elapsedTimeS)}</span>{' '}
              ({strategy.elapsedTimeS.toFixed(2)}s)
            </p>
          </div>
        </>
      )}
    </div>
  )
}
