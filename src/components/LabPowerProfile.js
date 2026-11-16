'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeProfile, mergeBests, PHENOTYPE_LABELS } from '../lib/powerProfile'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'

const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4'
const input = 'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm'
const PERIODS = [['90', 'Last 90 days'], ['365', 'Last year']]

// Power profile and phenotype from the athlete's best 5 s / 1 min / 5 min / 20 min power. Age and sex are
// only used for this view and are not stored.
export default function LabPowerProfile({ athleteId }) {
  const [curves, setCurves] = useState(null)
  const [weight, setWeight] = useState('')
  const [age, setAge] = useState('')
  const [sex, setSex] = useState('male')
  const [period, setPeriod] = useState('90')
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const since = new Date(Date.now() - Number(period) * 86400000).toISOString()
      const [acts, wh] = await Promise.all([
        supabase.from('activities').select('curves_data').eq('user_id', athleteId).gte('activity_date', since).limit(500),
        fetchWeightHistory(supabase, athleteId),
      ])
      if (!live) return
      if (acts.error) return setError('Could not load rides')
      setError(null)
      setCurves((acts.data || []).map((a) => a.curves_data?.Power || null))
      const w = weightAt(wh.history, new Date().toISOString().slice(0, 10))
      if (w) setWeight((cur) => cur || String(w))
    })()
    return () => { live = false }
  }, [athleteId, period])

  const profile = useMemo(
    () => computeProfile({ bests: mergeBests(curves), weightKg: weight, age: age || null, sex }),
    [curves, weight, age, sex],
  )

  return (
    <div className="space-y-4" data-testid="lab-power-profile">
      <section className={card}>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label>Period<br /><select value={period} onChange={(e) => setPeriod(e.target.value)} className={input}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label>Weight (kg)<br /><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={`${input} w-24`} /></label>
          <label>Age<br /><input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className={`${input} w-20`} /></label>
          <label>Benchmark<br /><select value={sex} onChange={(e) => setSex(e.target.value)} className={input}>
            <option value="male">Men</option><option value="female">Women</option>
          </select></label>
        </div>
        {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      </section>
      {profile.error ? <p className="text-xs text-slate-500">{profile.error}</p> : (
        <section className={card}>
          <ul className="space-y-2" data-testid="profile-bars">
            {profile.rows.map((r) => (
              <li key={r.key} className="text-xs">
                <div className="flex justify-between text-slate-700 dark:text-slate-300">
                  <span className="font-bold">{r.label}</span>
                  <span>{r.watts ? `${Math.round(r.watts)} W · ${r.wkg} W/kg · score ${r.score}` : 'no data'}</span>
                </div>
                <div className="h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-indigo-500" style={{ width: `${r.score || 0}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-extrabold text-slate-900 dark:text-white" data-testid="phenotype">
            {profile.phenotype ? `Phenotype: ${PHENOTYPE_LABELS[profile.phenotype.type]}` : 'Phenotype needs a best for all four durations'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Scores compare W/kg with approximate benchmarks (0 untrained, 50 good club rider, 100 world class), adjusted for sex and age over 35. The phenotype is the duration group with the highest relative score; guidance only.</p>
        </section>
      )}
    </div>
  )
}
