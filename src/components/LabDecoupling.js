'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DECOUPLING_REFERENCE_PCT, decouplingTrend } from '../lib/decoupling'
import { fetchRideStreams } from '../lib/labRides'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const card = adminCard

function TrendChart({ points }) {
  const W = 320
  const H = 140
  const pad = 26
  const max = Math.max(DECOUPLING_REFERENCE_PCT * 2, ...points.map((p) => p.result.decouplingPct))
  const min = Math.min(0, ...points.map((p) => p.result.decouplingPct))
  const x = (i) => pad + (points.length < 2 ? (W - pad * 2) / 2 : (i / (points.length - 1)) * (W - pad * 2))
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md text-slate-600 dark:text-slate-300" role="img" aria-label="Decoupling trend" data-testid="decoupling-chart">
      <line x1={pad} x2={W - pad} y1={y(DECOUPLING_REFERENCE_PCT)} y2={y(DECOUPLING_REFERENCE_PCT)} stroke="#16a34a" strokeDasharray="4 3" />
      <text x={W - pad} y={y(DECOUPLING_REFERENCE_PCT) - 3} fontSize="9" textAnchor="end" fill="#16a34a">{DECOUPLING_REFERENCE_PCT}%</text>
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.result.decouplingPct)}`).join(' ')} />
      {points.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.result.decouplingPct)} r="3" fill="#6366f1" />)}
    </svg>
  )
}

// Aerobic decoupling (Pw:HR) and efficiency factor across steady rides, computed from existing ride data.
export default function LabDecoupling({ athleteId }) {
  const [rides, setRides] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let live = true
    fetchRideStreams(supabase, athleteId, { days: 180, limit: 40, hr: true }).then(({ rides: r, error: e }) => {
      if (!live) return
      if (e) setError('Could not load rides')
      else setRides(r)
    })
    return () => { live = false }
  }, [athleteId])
  const trend = useMemo(() => (rides ? decouplingTrend(rides) : []), [rides])

  return (
    <div className="space-y-4" data-testid="lab-decoupling">
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Aerobic decoupling</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Compares watts per heartbeat in the first and second half of steady rides (45 minutes or more, variability index under 1.10). Under {DECOUPLING_REFERENCE_PCT}% means a solid aerobic base; a falling trend at the same effort means improving endurance.</p>
      </section>
      <section className={card}>
        <ErrorNote>{error}</ErrorNote>
        {rides && trend.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No steady rides with power and heart rate in the last 6 months.</p>}
        {trend.length > 0 && <TrendChart points={trend} />}
        <div className="overflow-x-auto"><table className="mt-3 text-sm w-full max-w-md" data-testid="decoupling-table">
          <thead><tr className="text-left text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-600"><th>Date</th><th>Avg W</th><th>EF</th><th>Decoupling</th></tr></thead>
          <tbody>
            {[...trend].reverse().map((t) => (
              <tr key={t.id} className="text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700">
                <td>{t.date}</td><td>{t.result.avgW}</td><td>{t.result.ef}</td>
                <td className={t.result.decouplingPct <= DECOUPLING_REFERENCE_PCT ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-amber-700 dark:text-amber-300 font-bold'}>{t.result.decouplingPct}%</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
