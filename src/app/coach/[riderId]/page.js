'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { currentReturnTo, withReturnTo } from '../../../lib/returnTo'
import { supabase } from '../../../lib/supabase'
import { fetchAthleteActivitiesPage } from '../../../lib/coaching'
import { fetchFtpHistory, ftpAt } from '../../../lib/ftpHistory'
import { fetchWeightHistory, weightAt } from '../../../lib/weightHistory'
import { fetchLtHistory, resolveLtAt } from '../../../lib/lactateThresholds'
import { athletePath, formatDistanceKm, formatDuration, formatLastActivity } from '../../../lib/coachContext'
import CoachBadge, { useCoachNames } from '../../../components/CoachBadge'
import CoachEditsList from '../../../components/CoachEditsList'
import { useAthlete } from '../../../components/AthleteContext'

function Stat({ label, value, badgeRow, names }) {
  return (
    <div className="p-3 rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder space-y-1">
      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{label}</p>
      <p className="text-lg font-black text-slate-900 dark:text-white">{value ?? '—'}</p>
      {badgeRow && <CoachBadge row={badgeRow} names={names} />}
    </div>
  )
}

// Per-athlete overview: current FTP / weight / lactate thresholds, recent activities and links.
export default function AthleteOverviewPage() {
  const returnTo = currentReturnTo(usePathname())
  const { riderId, athlete } = useAthlete()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!riderId) return
    let cancelled = false
    ;(async () => {
      const today = new Date().toISOString().slice(0, 10)
      const [acts, ftp, weight, lt] = await Promise.all([
        fetchAthleteActivitiesPage(supabase, { riderId, pageSize: 8 }),
        fetchFtpHistory(supabase, riderId),
        fetchWeightHistory(supabase, riderId),
        fetchLtHistory(supabase, riderId),
      ])
      if (cancelled) return
      setData({
        activities: acts.data,
        ftp: ftpAt(ftp.history, today),
        ftpRow: ftp.history[0] || null,
        weightRow: weight.history[0] || null,
        weight: weightAt(weight.history, today),
        lt: resolveLtAt(lt.history, today),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [riderId])

  const stamped = data ? [data.ftpRow, data.weightRow, data.lt].filter(Boolean) : []
  const names = useCoachNames(stamped)
  if (!data) return <p className="text-xs text-slate-400">Loading…</p>

  const lt = data.lt
  return (
    <div className="space-y-6" data-testid="athlete-overview">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="FTP" value={data.ftp ? `${data.ftp} W` : athlete?.ftp_w ? `${athlete.ftp_w} W` : null} badgeRow={data.ftpRow} names={names} />
        <Stat label="Weight" value={data.weight ? `${data.weight} kg` : null} badgeRow={data.weightRow} names={names} />
        <Stat label="LT1" value={lt?.lt1_power_w ? `${lt.lt1_power_w} W${lt.lt1_hr ? ` / ${lt.lt1_hr} bpm` : ''}` : null} badgeRow={lt} names={names} />
        <Stat label="LT2" value={lt?.lt2_power_w ? `${lt.lt2_power_w} W${lt.lt2_hr ? ` / ${lt.lt2_hr} bpm` : ''}` : null} badgeRow={lt} names={names} />
      </section>
      <p className="text-xs">
        <Link href={athletePath(riderId, '/calendar')} className="font-bold underline">Open calendar</Link>
        {' · '}
        <Link href={athletePath(riderId, '/physiology')} className="font-bold underline">Edit physiology</Link>
      </p>

      <section className="space-y-2">
        <h2 className="text-xs uppercase font-bold tracking-wider text-slate-400">Recent activities</h2>
        {data.activities.length === 0 && <p className="text-xs text-slate-500">No activities yet.</p>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.activities.map((a) => (
            <li key={a.id} className="py-2 text-xs flex justify-between gap-3">
              <Link href={withReturnTo(athletePath(riderId, `/activities/${a.id}`), returnTo)} className="font-semibold hover:underline truncate">
                {a.title || 'Untitled'}
              </Link>
              <span className="font-mono text-slate-500 shrink-0">
                {formatLastActivity(a.activity_date)} · {formatDuration(a.moving_time_s)} · {formatDistanceKm(a.distance_m)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <CoachEditsList riderId={riderId} />
    </div>
  )
}
