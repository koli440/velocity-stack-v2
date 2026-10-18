'use client'

import { useEffect, useMemo, useState } from 'react'
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { BASELINE_PERIODS } from '../lib/baselineCurves'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import { buildRadarData, hasProfileData, mapCurvesToProfile } from '../lib/powerProfile'

async function fetchPeriodCurves(userId, period) {
  const { data, error } = await supabase.rpc('get_athlete_baseline_curves', { p_user_id: userId, p_period: period })
  if (error) throw error
  return data?.curves || {}
}

export default function PowerProfileCard({ userId }) {
  const [state, setState] = useState({ loading: true, recent: null, allTime: null, weightKg: null })
  const [unit, setUnit] = useState('W')

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    Promise.all([
      fetchPeriodCurves(userId, BASELINE_PERIODS.LAST_90_DAYS).catch(() => null),
      fetchPeriodCurves(userId, BASELINE_PERIODS.ALL_TIME).catch(() => null),
      fetchWeightHistory(supabase, userId).catch(() => ({ history: [] })),
    ]).then(([recent, allTime, { history }]) => {
      if (cancelled) return
      setState({ loading: false, recent, allTime, weightKg: weightAt(history, new Date()) })
    })
    return () => { cancelled = true }
  }, [userId])

  const { loading, recent, allTime, weightKg } = state
  const perKg = unit === 'W/kg'
  const unitLabel = perKg ? 'W/kg' : 'W'

  const series = useMemo(() => {
    const opts = { perKg, weightKg }
    return { last90: mapCurvesToProfile(recent, opts), allTime: mapCurvesToProfile(allTime, opts) }
  }, [recent, allTime, perKg, weightKg])
  const data = useMemo(() => buildRadarData(series), [series])
  const hasData = hasProfileData(series.last90) || hasProfileData(series.allTime)
  const fmt = (v) => (v == null ? '—' : perKg ? v.toFixed(2) : Math.round(v))

  return (
    <section
      className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4"
      aria-labelledby="power-profile-title"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 id="power-profile-title" className="text-sm font-bold text-slate-800 dark:text-slate-100">Power profile</h2>
        <div role="group" aria-label="Power unit" className="flex rounded-lg border border-slate-200 dark:border-surface-darkBorder overflow-hidden text-xs font-semibold">
          {['W', 'W/kg'].map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`px-2 py-1 ${unit === u ? 'bg-purple-500 text-white' : 'text-slate-500 dark:text-slate-300'}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div role="status" className="h-56 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" aria-label="Loading power profile" />
      ) : !hasData ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
          {perKg && !weightKg && (hasProfileData(mapCurvesToProfile(allTime)) || hasProfileData(mapCurvesToProfile(recent)))
            ? 'Add your body weight in settings to see W/kg.'
            : 'No power data yet. Upload rides with a power meter to see your profile.'}
        </p>
      ) : (
        <>
          <div
            className="h-56"
            role="img"
            aria-label={`Power profile radar chart in ${unitLabel} across 15 seconds to 1 hour, last 90 days versus all-time. A table with the values follows.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} outerRadius="70%">
                <PolarGrid stroke="#94a3b8" strokeOpacity={0.4} />
                <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 'auto']} />
                <Radar name="All-time" dataKey="allTime" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.15} />
                <Radar name="Last 90 days" dataKey="last90" stroke="#a855f7" fill="#a855f7" fillOpacity={0.35} />
                <Tooltip formatter={(v) => (v == null ? '—' : `${fmt(v)} ${unitLabel}`)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Best power by duration ({unitLabel})</caption>
            <thead>
              <tr><th scope="col">Duration</th><th scope="col">Last 90 days</th><th scope="col">All-time</th></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.key}><th scope="row">{r.label}</th><td>{fmt(r.last90)}</td><td>{fmt(r.allTime)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
