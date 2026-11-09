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
import DisciplineSuggest from '../../components/DisciplineSuggest'
import { fetchDisciplines, fetchTracks } from '../../lib/lookups'
import {
  getTrackLaps,
  parseDistanceOverride,
  calculatePursuitStrategy,
  formatTime,
  pacingStrategyLabel,
} from '../../lib/pursuit'
import VelodromePicker from '../../components/VelodromePicker'
import Icon from '../../components/Icon'
import GearPicker, { useGearState } from '../../components/GearPicker'
import { LockedExtra, LockedHint, SignupBanner } from '../../components/SignupCatch'
import { buildPacingCurve, applyPacingShape, fallbackMessage, lapDeltas } from '../../lib/pacingCurve'
import { parseGear, PURSUIT_GEAR_START } from '../../lib/gear'

import ChartTooltip from '@/components/ChartTooltip'
import { TOOLTIP_CURSOR_LINE } from '@/lib/chartTooltip'
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

// "Pursuit Strategist" - migrated from v1's pages/10_pursuit.py. Account-free: AppShell lists it in
// the public tool paths (src/lib/publicPaths.js). Home track and saved gear are signed-in extras.
function fmtDelta(d) {
  return `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(2)}s`
}

function PacingChangeChart({ mine, generic }) {
  const myD = lapDeltas(mine)
  const genD = lapDeltas(generic)
  const max = Math.max(0.01, ...myD.slice(1).map(Math.abs), ...genD.slice(1).map(Math.abs))
  const pct = (d) => Math.min(100, (Math.abs(d) / max) * 100)
  const faster = myD.slice(1).filter((d) => d < 0).length
  const summary = `Change vs previous lap, ${myD.length - 1} laps after the start: ${faster} faster, ${
    myD.length - 1 - faster
  } slower. ${myD
    .map((d, i) => (d === null ? 'Lap 1 start' : `Lap ${i + 1} ${fmtDelta(d)}`))
    .join(', ')}.`
  return (
    <div className="space-y-1">
      <div role="img" aria-label={summary} className="flex gap-1">
        {myD.map((d, i) => (
          <div key={i} className="flex-1 min-w-0 text-center">
            <div className="text-[10px] h-3 leading-3 text-slate-500 dark:text-slate-400 truncate">
              {d === null ? '' : d < 0 ? fmtDelta(d) : ''}
            </div>
            <div className="relative h-20" title={d === null ? 'Lap 1: start' : `Lap ${i + 1}: ${fmtDelta(d)} vs previous lap`}>
              <div className="absolute inset-x-0 top-1/2 border-t border-slate-300 dark:border-slate-600" />
              {d === null ? (
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">start</span>
              ) : (
                <>
                  <div
                    style={{ height: `${pct(d) / 2}%` }}
                    className={`absolute inset-x-[15%] rounded-sm ${
                      d < 0 ? 'bottom-1/2 bg-emerald-500' : 'top-1/2 bg-amber-400'
                    }`}
                  />
                  {genD[i] !== null && (
                    <div
                      style={{ top: `${50 - (Math.sign(-genD[i]) * pct(genD[i])) / 2}%` }}
                      className="absolute inset-x-0 border-t-2 border-slate-500/50 dark:border-slate-300/50"
                    />
                  )}
                </>
              )}
            </div>
            <div className="text-[10px] h-3 leading-3 text-slate-500 dark:text-slate-400 truncate">
              {d !== null && d >= 0 ? fmtDelta(d) : ''}
            </div>
            <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{i + 1}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        Change vs the previous lap, by lap number. Green = faster than the previous lap (speeding up), amber =
        slower. The grey line shows the generic plan for comparison.
      </p>
    </div>
  )
}

export default function PursuitPage() {
  const [tracks, setTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(true)
  const [homeTrackId, setHomeTrackId] = useState(null)

  const [trackId, setTrackId] = useState('')
  const [category, setCategory] = useState('')
  const [disciplineName, setDisciplineName] = useState('')

  const [targetMin, setTargetMin] = useState(3)
  const [targetSec, setTargetSec] = useState(30)
  const [disciplines, setDisciplines] = useState([])
  const [distanceInput, setDistanceInput] = useState('')
  const [startPenalty, setStartPenalty] = useState(5)
  const [pacingDrift, setPacingDrift] = useState(0)
  const [userId, setUserId] = useState(null)
  const [usePersonal, setUsePersonal] = useState(false)
  const [pbRecords, setPbRecords] = useState(null)
  // Saved default when set, else a calculator-only starting gear (never saved).
  const { gear, setGear } = useGearState(userId, PURSUIT_GEAR_START)
  const parsedGear = parseGear(gear.chainring, gear.cog)
  const gearReady = parsedGear.valid && !parsedGear.empty

  useEffect(() => {
    let active = true
    fetchTracks(supabase)
      .then(async ({ data, error }) => {
        let home = null
        try {
          const { data: auth } = await supabase.auth.getUser()
          if (auth?.user) {
            setUserId(auth.user.id)
            const { data: profile } = await supabase
              .from('profiles')
              .select('home_track_id')
              .eq('id', auth.user.id)
              .maybeSingle()
            home = profile?.home_track_id || null
          }
        } catch {}
        if (!active) return
        if (!error && data) {
          setTracks(data)
          const pick = data.find((t) => t.id === home) || data[0]
          if (pick) setTrackId((cur) => cur || pick.id)
          setHomeTrackId(home)
        }
        setLoadingTracks(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchDisciplines(supabase).then((list) => {
      if (active) setDisciplines(list)
    })
    return () => {
      active = false
    }
  }, [])

  const CATEGORIES = useMemo(
    () => Array.from(new Set(disciplines.map((d) => d.category))).sort(),
    [disciplines]
  )

  useEffect(() => {
    if (!category && CATEGORIES.length > 0) setCategory(CATEGORIES.includes('Endurance') ? 'Endurance' : CATEGORIES[0])
  }, [category, CATEGORIES])

  const filteredDisciplines = useMemo(
    () => disciplines.filter((d) => d.category === category),
    [disciplines, category]
  )

  useEffect(() => {
    if (
      filteredDisciplines.length > 0 &&
      !filteredDisciplines.some((d) => d.name === disciplineName)
    ) {
      setDisciplineName(filteredDisciplines[0].name)
      setDistanceInput('')
    }
  }, [filteredDisciplines, disciplineName])

  const selectedTrack = tracks.find((t) => t.id === trackId) || null
  const selectedDiscipline = disciplines.find((d) => d.name === disciplineName) || null
  const trackLengthM = selectedTrack ? Number(selectedTrack.length_m) : 0
  const targetSeconds = (Number(targetMin) || 0) * 60 + (Number(targetSec) || 0)

  const override = parseDistanceOverride(distanceInput)
  const distanceM = override.value ?? selectedDiscipline?.distanceM ?? 0
  const isOverridden = override.value !== null && override.value !== selectedDiscipline?.distanceM

  const lapsInfo =
    selectedTrack && selectedDiscipline && !override.error
      ? getTrackLaps(trackLengthM, distanceM)
      : { laps: 0, valid: false }

  // PB Vault records of this discipline at exactly this distance (RLS scopes them to the rider).
  useEffect(() => {
    if (!userId || !disciplineName || !(distanceM > 0)) {
      setPbRecords(null)
      return
    }
    let active = true
    setPbRecords(null)
    supabase
      .from('personal_bests')
      .select('lap_times, time_seconds')
      .eq('discipline', disciplineName)
      .eq('discipline_distance_m', Math.round(distanceM))
      .then(({ data, error }) => {
        if (active) setPbRecords(error ? [] : data || [])
      })
    return () => {
      active = false
    }
  }, [userId, disciplineName, distanceM])

  const personalCurve =
    userId && usePersonal && pbRecords && lapsInfo.valid && lapsInfo.laps > 1
      ? buildPacingCurve(pbRecords, lapsInfo.laps, { trackLengthM })
      : null

  const strategyParams =
    gearReady && lapsInfo.valid && lapsInfo.laps > 1 && selectedTrack && selectedDiscipline && targetSeconds > 0
      ? {
          trackLengthM,
          laps: lapsInfo.laps,
          totalDistanceM: distanceM,
          targetSeconds,
          startPenaltyS: Number(startPenalty) || 0,
          pacingDriftS: Number(pacingDrift) || 0,
          chainring: parsedGear.chainring,
          cog: parsedGear.cog,
        }
      : null

  const genericStrategy = strategyParams ? calculatePursuitStrategy(strategyParams) : null
  const personalStrategy =
    strategyParams && personalCurve?.ok
      ? calculatePursuitStrategy({
          ...strategyParams,
          lapTimesS: applyPacingShape(personalCurve.shape, targetSeconds, personalCurve.firstLap?.seconds),
        })
      : null
  const strategy = personalStrategy || genericStrategy

  const strategyLabel = pacingStrategyLabel(Number(pacingDrift) || 0)
  const banner = STRATEGY_BANNER[strategyLabel]

  const chartData = strategy
    ? strategy.laps.map((l) => ({
        lap: l.lap,
        speedKmh: l.speedKmh,
        cadenceRpm: l.cadenceRpm,
        overallTimeS: l.overallTimeS,
        genericLapTimeS: genericStrategy?.laps[l.lap - 1]?.lapTimeS,
        lapTimeS: l.lapTimeS,
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
          <Icon name="stopwatch" /> Pursuit Strategist
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
                'Category',
                category,
                setCategory,
                CATEGORIES.map((c) => ({ value: c, label: c }))
              )}
              {select(
                'Discipline',
                disciplineName,
                (v) => {
                  setDisciplineName(v)
                  setDistanceInput('')
                },
                filteredDisciplines.map((d) => ({ value: d.name, label: d.name }))
              )}
            </div>
            <DisciplineSuggest categories={CATEGORIES} />

            <div className="relative z-30 block space-y-1.5">
              <span className="text-xs uppercase font-bold text-slate-400">Velodrome</span>
              <VelodromePicker tracks={tracks} value={trackId} onChange={setTrackId} favoriteId={homeTrackId} />
              <LockedHint>Set a home track and a default gear to have them preselected.</LockedHint>
            </div>

            {selectedDiscipline && (
              <div className="space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">
                  Distance (m) — default {selectedDiscipline.distanceM}
                </span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={100}
                    max={100000}
                    value={distanceInput}
                    placeholder={String(selectedDiscipline.distanceM)}
                    onChange={(e) => setDistanceInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-surface-darkBorder bg-transparent px-3 py-2 text-sm"
                  />
                  {distanceInput !== '' && (
                    <button
                      type="button"
                      onClick={() => setDistanceInput('')}
                      className="shrink-0 rounded-lg border border-slate-200 dark:border-surface-darkBorder px-3 py-2 text-xs font-bold"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {override.error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{override.error}</p>
                )}
              </div>
            )}
            {selectedDiscipline && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Distance: <span className="font-bold">{distanceM}m</span>
                {isOverridden && ' (custom)'} | Total
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

        {userId && (
          <div className="rounded-xl border border-slate-200 dark:border-surface-darkBorder p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={usePersonal}
                onChange={(e) => setUsePersonal(e.target.checked)}
                className="accent-emerald-500"
              />
              Use my pacing
            </label>
            <p className="text-[11px] text-slate-400">
              Shapes the lap times like your typical effort over this exact distance, from your PB Vault records.
              Total time stays at your target. Replaces start penalty and drift.
            </p>
            {usePersonal && pbRecords === null && (
              <p className="text-xs text-slate-400">Loading your records…</p>
            )}
            {personalCurve?.ok && personalStrategy && genericStrategy && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Based on {personalCurve.recordsUsed} of {personalCurve.recordsTotal} record
                  {personalCurve.recordsTotal === 1 ? '' : 's'} with lap splits.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {personalCurve.firstLap
                    ? `Lap 1: ${personalStrategy.laps[0].lapTimeS.toFixed(1)} s, weighted average of ${personalCurve.firstLap.used} record${
                        personalCurve.firstLap.used === 1 ? '' : 's'
                      }, newer weigh more.`
                    : `Lap 1: ${personalStrategy.laps[0].lapTimeS.toFixed(1)} s, from your typical pacing shape (no record with matching laps).`}
                </p>
                <PacingChangeChart
                  mine={personalStrategy.laps.map((l) => l.lapTimeS)}
                  generic={genericStrategy.laps.map((l) => l.lapTimeS)}
                />
              </div>
            )}
            {personalCurve && !personalCurve.ok && (
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                {fallbackMessage(personalCurve.reason, { disciplineName, distanceM })}
              </p>
            )}
          </div>
        )}

        <div>
          <GearPicker label="Gear" chainring={gear.chainring} cog={gear.cog} onChange={setGear} className="max-w-xs" />
        </div>
      </div>

      {!strategy ? (
        <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm text-sm text-slate-500 dark:text-slate-400">
          {tracks.length === 0
            ? 'Add a track to the database to use the strategist.'
            : !gearReady
            ? 'Enter a valid chainring and cog to compute a strategy.'
            : 'Distance must be longer than 1 lap and must cleanly divide the selected track to compute a strategy.'}
        </div>
      ) : (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {metric('Distance', `${distanceM}`, 'm')}
            {metric('Track', `${trackLengthM}`, 'm')}
            {metric('Target', formatTime(targetSeconds))}
            {metric('Avg Speed', strategy.avgSpeedKmh.toFixed(2), 'km/h')}
            {metric('Laps', `${lapsInfo.laps}x`)}
            {metric('Gear', `${parsedGear.chainring}x${parsedGear.cog}`)}
            {metric('Avg Cadence', strategy.avgCadenceRpm.toFixed(0), 'RPM')}
            {metric('Avg Lap Time', strategy.avgLapTimeS.toFixed(3), 's')}
          </div>

          {/* Strategy banner */}
          {personalStrategy ? (
            <div className="p-4 rounded-2xl border text-sm font-semibold bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
              <div className="font-bold">Strategy: YOUR PACING</div>
              <div className="text-xs opacity-90 mt-0.5">
                Lap times follow your typical effort over {distanceM} m; the generic plan is shown alongside in the splits.
              </div>
            </div>
          ) : (
            <div className={`p-4 rounded-2xl border text-sm font-semibold ${banner.className}`}>
              <div className="font-bold">{banner.label}</div>
              <div className="text-xs opacity-90 mt-0.5">{banner.detail}</div>
            </div>
          )}

          {/* Splits table */}
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm overflow-x-auto">
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3"><Icon name="clipboard" /> Splits</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-surface-darkBorder">
                  <th className="py-2 pr-4">Lap</th>
                  <th className="py-2 pr-4">{personalStrategy ? 'My pacing lap time (s)' : 'Lap time (s)'}</th>
                  {personalStrategy && <th className="py-2 pr-4">Generic lap time (s)</th>}
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
                    {personalStrategy && (
                      <td className="py-1.5 pr-4 text-slate-400">{genericStrategy.laps[l.lap - 1].lapTimeS.toFixed(3)}</td>
                    )}
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
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3"><Icon name="trend" /> Tempo Analysis</h2>
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
                  <Tooltip cursor={TOOLTIP_CURSOR_LINE} content={<ChartTooltip />} />
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
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-3"><Icon name="settings" /> Cadence (RPM)</h2>
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
                  <Tooltip cursor={TOOLTIP_CURSOR_LINE} content={<ChartTooltip />} />
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
            <h2 className="text-xs uppercase font-bold text-slate-400 mb-1"><Icon name="bulb" /> Training Notes</h2>
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
      <SignupBanner usage={`${trackId}|${disciplineName}|${targetMin}|${targetSec}|${startPenalty}|${pacingDrift}|${gear.chainring}x${gear.cog}`} />

      <LockedExtra
        title="Your personal bests"
        description="Compare your plan with your PB Vault for this discipline and keep your home track and gear ready every time."
      />
    </div>
  )
}
