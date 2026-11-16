'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { durabilityRating, durabilityTrend, DURABILITY_KJ } from '../lib/durability'
import { fetchRideStreams } from '../lib/labRides'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const card = adminCard

// Durability: best 5 min power fresh vs after ~2000 kJ in the same ride, over the last months of rides.
export default function LabDurability({ athleteId }) {
  const [rides, setRides] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let live = true
    fetchRideStreams(supabase, athleteId, { days: 180, limit: 40 }).then(({ rides: r, error: e }) => {
      if (!live) return
      if (e) setError('Could not load rides')
      else setRides(r)
    })
    return () => { live = false }
  }, [athleteId])
  const trend = useMemo(() => (rides ? durabilityTrend(rides) : []), [rides])

  return (
    <div className="space-y-4" data-testid="lab-durability">
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">How to test</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Ride a 5 minute maximal effort fresh, then ride about {DURABILITY_KJ} kJ at endurance intensity (roughly 2.5 to 3 hours) and repeat the 5 minute effort. Upload the ride: the best 5 minutes before and after {DURABILITY_KJ} kJ of work are compared automatically.</p>
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">Results</h2>
        <ErrorNote>{error}</ErrorNote>
        {rides && trend.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No ride in the last 6 months reached {DURABILITY_KJ} kJ with a 5 minute effort before and after.</p>}
        <ul className="space-y-2 mt-2" data-testid="durability-results">
          {trend.map((t) => (
            <li key={t.id} className="text-sm text-slate-800 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-600 p-3 break-words">
              <span className="font-bold">{t.date}</span> {t.title || 'Ride'}: fresh {t.result.freshW} W, after {t.result.kj} kJ {t.result.fatiguedW} W,{' '}
              <span className="font-bold">{t.result.dropPct >= 0 ? '-' : '+'}{Math.abs(t.result.dropPct)}%</span> ({durabilityRating(t.result.dropPct)})
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
