'use client'

import { useEffect, useMemo, useState } from 'react'
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { BASELINE_PERIODS } from '../lib/baselineCurves'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import SegmentedTabs from './SegmentedTabs'
import { allTimeStyle, buildRadarData, hasProfileData, mapCurvesToProfile, RECENT_COLOR } from '../lib/powerProfile'

async function fetchPeriodCurves(userId, period) {
  const { data, error } = await supabase.rpc('get_athlete_baseline_curves', { p_user_id: userId, p_period: period })
  if (error) throw error
  return data?.curves || {}
}

function useIsDark() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const read = () => setDark(el.classList.contains('dark'))
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

function LegendSwatch({ dashed, style, fill }) {
  return (
    <svg width="22" height="10" aria-hidden="true">
      {dashed ? (
        <line x1="1" y1="5" x2="21" y2="5" stroke={style.stroke} strokeWidth={style.strokeWidth} />
      ) : (
        <rect x="1" y="1" width="20" height="8" rx="2" fill={fill} fillOpacity="0.3" stroke={fill} strokeWidth="1.5" />
      )}
    </svg>
  )
}

export default function PowerProfileCard({ userId }) {
  const [state, setState] = useState({ loading: true, recent: null, allTime: null, weightKg: null })
  const [unit, setUnit] = useState('W')
  const isDark = useIsDark()
  const atStyle = allTimeStyle(isDark)

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
        <SegmentedTabs label="Power unit" tabs={[['W', 'W'], ['W/kg', 'W/kg']]} value={unit} onChange={setUnit} />
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
                <Radar name="Last 90 days" dataKey="last90" stroke={RECENT_COLOR} fill={RECENT_COLOR} fillOpacity={0.2} />
                <Radar
                  name="All-time"
                  dataKey="allTime"
                  stroke={atStyle.stroke}
                  strokeWidth={atStyle.strokeWidth}
                  fill="none"
                  fillOpacity={0}
                  dot={false}
                />
                <Tooltip formatter={(v) => (v == null ? '—' : `${fmt(v)} ${unitLabel}`)} />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  content={() => (
                    <ul className="flex justify-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
                      <li className="flex items-center gap-1.5"><LegendSwatch fill={RECENT_COLOR} /> Last 90 days</li>
                      <li className="flex items-center gap-1.5"><LegendSwatch dashed style={atStyle} /> All-time</li>
                    </ul>
                  )}
                />
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
