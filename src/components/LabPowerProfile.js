'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeProfile, mergeBests, PHENOTYPE_LABELS } from '../lib/labPowerProfile'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const card = adminCard
const input = adminInput
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Period</span><select value={period} onChange={(e) => setPeriod(e.target.value)} className={input}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Weight (kg)</span><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Age</span><input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Benchmark</span><select value={sex} onChange={(e) => setSex(e.target.value)} className={input}>
            <option value="male">Men</option><option value="female">Women</option>
          </select></label>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </section>
      {profile.error ? <div className={`${card} text-sm text-slate-700 dark:text-slate-200`}>{profile.error}</div> : (
        <section className={card}>
          <ul className="space-y-2" data-testid="profile-bars">
            {profile.rows.map((r) => (
              <li key={r.key} className="text-sm">
                <div className="flex flex-wrap justify-between gap-x-3 text-slate-800 dark:text-slate-200 mb-1">
                  <span className="font-bold">{r.label}</span>
                  <span>{r.watts ? `${Math.round(r.watts)} W · ${r.wkg} W/kg · score ${r.score}` : 'no data'}</span>
                </div>
                <div className="h-2.5 rounded bg-slate-200 dark:bg-slate-700"><div className="h-2.5 rounded bg-orange-500" style={{ width: `${r.score || 0}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white" data-testid="phenotype">
            {profile.phenotype ? `Phenotype: ${PHENOTYPE_LABELS[profile.phenotype.type]}` : 'Phenotype needs a best for all four durations'}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Scores compare W/kg with approximate benchmarks (0 untrained, 50 good club rider, 100 world class), adjusted for sex and age over 35. The phenotype is the duration group with the highest relative score; guidance only.</p>
        </section>
      )}
    </div>
  )
}
