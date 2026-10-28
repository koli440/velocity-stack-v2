'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'
import FitnessChart, { FITNESS_COLORS } from './FitnessChart'
import { Metric, FitnessNotes, FITNESS_HELP } from './FitnessCard'
import { useFitnessData } from './useFitnessData'
import { FITNESS_RANGES, fitnessSummary, addDays } from '../lib/fitnessForm'
import { fetchRacesInRange, RACE_PRIORITY_STYLES } from '../lib/calendarRaces'
import { fetchPlannedInRange } from '../lib/plannedWorkouts'
import { useRiderLoadContext } from './useRiderLoadContext'
import { projectFitness, partialForecastNote, PROJECTION_HORIZONS, PROJECTION_MAX_DAYS } from '../lib/fitnessProjection'

// Full Fitness / Fatigue / Form view of ONE rider: the own page (`userId` = signed-in rider) and the coach's
// athlete page (`coach`, `userId` = rider id; data via the coach-gated RPC). Every query names the rider.
export default function FitnessView({ userId, coach = false }) {
  const [rangeKey, setRangeKey] = useState('12w')
  const [races, setRaces] = useState([])
  const [planned, setPlanned] = useState([])
  const [horizonKey, setHorizonKey] = useState('4w')
  const range = FITNESS_RANGES.find((r) => r.key === rangeKey)
  const { loading, error, daily, skipped, firstDay, series, today } = useFitnessData(userId, range.days, { coach })
  const summary = fitnessSummary(daily, today, firstDay)

  useEffect(() => {
    if (!userId) return
    const endDay = addDays(today, PROJECTION_MAX_DAYS)
    fetchRacesInRange(supabase, { riderId: userId, startDay: addDays(today, -(range.days - 1)), endDay }).then(
      ({ data }) => setRaces(data || [])
    )
    // Planned workouts of the named rider only (a coach reads the athlete's through RLS; no raw activities).
    fetchPlannedInRange(supabase, { riderId: userId, startDay: addDays(today, 1), endDay }).then(
      ({ data }) => setPlanned(data || [])
    )
  }, [userId, range.days, today])

  const loadContext = useRiderLoadContext(userId)
  const horizon = PROJECTION_HORIZONS.find((h) => h.key === horizonKey)
  const projection = useMemo(
    () => (horizon ? projectFitness(daily, { today, planned, races, horizonDays: horizon.days, loadContext }) : null),
    [daily, today, planned, races, horizon, loadContext]
  )
  const forecast = projection && !projection.empty ? projection : null
  const forecastEnd = forecast ? forecast.series[forecast.series.length - 1].day : today
  const rangeRaces = races.filter((r) => series.some((p) => p.day === r.race_date) || (forecast && r.race_date > today && r.race_date <= forecastEnd))

  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        <Icon name="chart" /> Fitness, fatigue &amp; form
      </h1>
      <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 space-y-4">
        <div role="group" aria-label="Forecast horizon" className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Forecast from planned workouts</span>
          {[{ key: 'off', label: 'Off' }, ...PROJECTION_HORIZONS].map((h) => (
            <button
              key={h.key}
              type="button"
              aria-pressed={h.key === horizonKey}
              onClick={() => setHorizonKey(h.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                h.key === horizonKey
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-brand-neon'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Chart range" className="flex flex-wrap gap-2">
          {FITNESS_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={r.key === rangeKey}
              onClick={() => setRangeKey(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                r.key === rangeKey
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-brand-neon'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div role="status" aria-label="Loading fitness" className="h-72 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" />
        ) : error ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
        ) : summary.empty ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
            {coach
              ? 'No training load yet. It appears once the athlete has rides with power (and an FTP set) or heart rate (and a lactate threshold heart rate set under Physiology).'
              : 'No training load yet. Upload rides with power (with an FTP set) or heart rate (with a lactate threshold heart rate set in Settings) and your fitness, fatigue and form will appear here.'}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3 max-w-md">
              <Metric id="fitness" label="Fitness" value={summary.fitness} color={FITNESS_COLORS.fitness} />
              <Metric id="fatigue" label="Fatigue" value={summary.fatigue} color={FITNESS_COLORS.fatigue} />
              <Metric id="form" label="Form" value={summary.form} color={FITNESS_COLORS.form} />
            </dl>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {summary.status.label}
              {summary.ramp !== null && <span className="font-normal text-slate-500 dark:text-slate-400"> · Ramp {summary.ramp > 0 ? '+' : ''}{summary.ramp} fitness/week</span>}
            </p>
            <FitnessChart
              series={series}
              races={rangeRaces}
              projection={forecast ? forecast.series : []}
              label={`Fitness ${summary.fitness}, fatigue ${summary.fatigue}, form ${summary.form} today, over the last ${range.label}`}
            />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300" aria-label="Legend">
              <li><span style={{ color: FITNESS_COLORS.fitness }}>●</span> Fitness</li>
              <li><span style={{ color: FITNESS_COLORS.fatigue }}>●</span> Fatigue</li>
              <li><span style={{ color: FITNESS_COLORS.form }}>●</span> Form</li>
              <li><span className="text-slate-400">▮</span> Daily load</li>
              <li><span className="text-slate-400">▨</span> Estimated from heart rate</li>
              <li><span className="text-amber-500">┆</span> Race</li>
              {forecast && <li><span className="text-slate-400">╌</span> Dashed = forecast (estimate from planned workouts)</li>}
            </ul>
            {forecast && (
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1" data-testid="forecast-notes">
                <p>
                  Forecast: planned workouts count by their estimated load; missed, skipped and unplanned days count as zero training. It is an estimate, not a prediction.
                </p>
                {forecast.noEstimate > 0 && (
                  <p className="font-semibold text-amber-700 dark:text-amber-300">{partialForecastNote(forecast.noEstimate)}</p>
                )}
                {forecast.planned === 0 && <p>No planned workouts in this period, so the forecast assumes rest.</p>}
              </div>
            )}
            <FitnessNotes summary={summary} skipped={skipped} />
            {rangeRaces.length > 0 && (
              <div>
                <h2 className="text-xs font-black uppercase tracking-wide text-slate-900 dark:text-white mb-1">Races in this range</h2>
                <ul className="space-y-1">
                  {rangeRaces.map((r) => (
                    <li key={r.id} className="text-xs text-slate-700 dark:text-slate-200">
                      <span className={`inline-block px-1.5 rounded border mr-2 text-[10px] font-bold ${RACE_PRIORITY_STYLES[r.priority] || ''}`}>{r.priority}</span>
                      {r.race_date} · {r.name}
                      {forecast?.raceForms.filter((f) => f.race.id === r.id).map((f) => (
                        <span key="f" className="ml-2 text-slate-500 dark:text-slate-400">
                          · projected form <b>{f.form}</b> ({f.status.label.toLowerCase()}), {f.daysAway} day{f.daysAway === 1 ? '' : 's'} away
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
      <section className="text-xs text-slate-600 dark:text-slate-300 space-y-1 max-w-2xl">
        <h2 className="text-xs font-black uppercase tracking-wide text-slate-900 dark:text-white">How to read this</h2>
        <p>{FITNESS_HELP.fitness}</p>
        <p>{FITNESS_HELP.fatigue}</p>
        <p>{FITNESS_HELP.form}</p>
        <p>Daily load comes from each ride&apos;s stored training load (power, using the FTP in effect on that day). Rides without one are estimated from average heart rate and {coach ? "the athlete's" : 'your'} lactate threshold heart rate, and are marked as estimates.</p>
      </section>
    </div>
  )
}
