'use client'

import Link from 'next/link'
import { useFitnessData } from './useFitnessData'
import FitnessChart, { FITNESS_COLORS } from './FitnessChart'
import { fitnessSummary } from '../lib/fitnessForm'

export const FITNESS_HELP = {
  fitness: 'Fitness (CTL): your average daily training load over roughly the last 6 weeks. It rises slowly as you train consistently.',
  fatigue: 'Fatigue (ATL): your average daily training load over roughly the last week. It rises and falls quickly.',
  form: 'Form (TSB): yesterday\u2019s Fitness minus yesterday\u2019s Fatigue. Negative means tired from recent training, positive means fresh.',
}

export function FitnessNotes({ summary, skipped }) {
  return (
    <>
      {summary.building && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          Building baseline: with under 6 weeks of data these numbers are still settling.
        </p>
      )}
      {summary.rampLevel && (
        <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
          {summary.rampLevel === 'warning' ? 'Warning: ' : 'Heads up: '}
          Fitness rose {summary.ramp} in the last week. Fast ramps raise injury and burnout risk.
        </p>
      )}
      {summary.estimateShare > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {Math.round(summary.estimateShare * 100)}% of the last 6 weeks&rsquo; load is estimated from heart rate (hatched bars).
        </p>
      )}
      {skipped > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {skipped} {skipped === 1 ? 'ride has' : 'rides have'} no power load or heart-rate threshold and {skipped === 1 ? 'is' : 'are'} not counted.
        </p>
      )}
    </>
  )
}

export function Metric({ id, label, value, color }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
        <span tabIndex={0} title={FITNESS_HELP[id]} aria-label={`${label}. ${FITNESS_HELP[id]}`} className="cursor-help underline decoration-dotted">
          {label}
        </span>
      </dt>
      <dd className="text-lg font-black" style={{ color }}>
        {value > 0 && id === 'form' ? '+' : ''}
        {value}
      </dd>
    </div>
  )
}

// Dashboard card: current Fitness / Fatigue / Form with a ~90-day mini chart.
export default function FitnessCard({ userId }) {
  const { loading, error, daily, skipped, firstDay, series, today } = useFitnessData(userId, 90)
  const summary = fitnessSummary(daily, today, firstDay)

  return (
    <section aria-labelledby="fitness-card-title" className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="fitness-card-title" className="text-xs font-black uppercase tracking-wide text-slate-900 dark:text-white">
          Fitness &amp; form
        </h2>
        <Link href="/fitness" className="text-[11px] font-bold text-orange-500 hover:text-orange-600">
          Details
        </Link>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading…</p>
      ) : error ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{error}</p>
      ) : summary.empty ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Upload rides with power (and set your FTP) or heart rate (and set your lactate threshold heart rate) to see your fitness and form.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Metric id="fitness" label="Fitness" value={summary.fitness} color={FITNESS_COLORS.fitness} />
            <Metric id="fatigue" label="Fatigue" value={summary.fatigue} color={FITNESS_COLORS.fatigue} />
            <Metric id="form" label="Form" value={summary.form} color={FITNESS_COLORS.form} />
          </dl>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{summary.status.label}</p>
          <FitnessChart
            compact
            series={series}
            label={`Fitness ${summary.fitness}, fatigue ${summary.fatigue}, form ${summary.form} over the last 90 days`}
          />
          <FitnessNotes summary={summary} skipped={skipped} />
        </>
      )}
    </section>
  )
}
