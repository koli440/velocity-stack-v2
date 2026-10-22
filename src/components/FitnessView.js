'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'
import FitnessChart, { FITNESS_COLORS } from './FitnessChart'
import { Metric, FitnessNotes, FITNESS_HELP } from './FitnessCard'
import { useFitnessData } from './useFitnessData'
import { FITNESS_RANGES, fitnessSummary, addDays } from '../lib/fitnessForm'
import { fetchRacesInRange, RACE_PRIORITY_STYLES } from '../lib/calendarRaces'

// Full Fitness / Fatigue / Form view of ONE rider: the own page (`userId` = signed-in rider) and the coach's
// athlete page (`coach`, `userId` = rider id; data via the coach-gated RPC). Every query names the rider.
export default function FitnessView({ userId, coach = false }) {
  const [rangeKey, setRangeKey] = useState('12w')
  const [races, setRaces] = useState([])
  const range = FITNESS_RANGES.find((r) => r.key === rangeKey)
  const { loading, error, daily, skipped, firstDay, series, today } = useFitnessData(userId, range.days, { coach })
  const summary = fitnessSummary(daily, today, firstDay)

  useEffect(() => {
    if (!userId) return
    fetchRacesInRange(supabase, { riderId: userId, startDay: addDays(today, -(range.days - 1)), endDay: today }).then(
      ({ data }) => setRaces(data || [])
    )
  }, [userId, range.days, today])

  const rangeRaces = races.filter((r) => series.some((p) => p.day === r.race_date))

  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        <Icon name="chart" /> Fitness, fatigue &amp; form
      </h1>
      <section className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 space-y-4">
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
              label={`Fitness ${summary.fitness}, fatigue ${summary.fatigue}, form ${summary.form} today, over the last ${range.label}`}
            />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300" aria-label="Legend">
              <li><span style={{ color: FITNESS_COLORS.fitness }}>●</span> Fitness</li>
              <li><span style={{ color: FITNESS_COLORS.fatigue }}>●</span> Fatigue</li>
              <li><span style={{ color: FITNESS_COLORS.form }}>●</span> Form</li>
              <li><span className="text-slate-400">▮</span> Daily load</li>
              <li><span className="text-slate-400">▨</span> Estimated from heart rate</li>
              <li><span className="text-amber-500">┆</span> Race</li>
            </ul>
            <FitnessNotes summary={summary} skipped={skipped} />
            {rangeRaces.length > 0 && (
              <div>
                <h2 className="text-xs font-black uppercase tracking-wide text-slate-900 dark:text-white mb-1">Races in this range</h2>
                <ul className="space-y-1">
                  {rangeRaces.map((r) => (
                    <li key={r.id} className="text-xs text-slate-700 dark:text-slate-200">
                      <span className={`inline-block px-1.5 rounded border mr-2 text-[10px] font-bold ${RACE_PRIORITY_STYLES[r.priority] || ''}`}>{r.priority}</span>
                      {r.race_date} · {r.name}
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
