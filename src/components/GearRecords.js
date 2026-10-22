'use client'

import Link from 'next/link'
import useContextHref from './useContextHref'
import { useEffect, useState } from 'react'
import { fetchGearRecords, selectedGear } from '../lib/gearRecords'
import { formatTime, formatElapsed } from '../lib/format'
import { formatDate } from '../lib/pbVault'

const card =
  'glass-card bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm'
const th = 'py-1 pr-3 text-left text-xs uppercase text-slate-400'
const td = 'py-1.5 pr-3 text-slate-900 dark:text-white'

/**
 * Gear Architect: PB Vault records and race rides (activities tagged "race") for the selected gear, incl.
 * per-segment gears. Own account only: queries filter by the signed-in owner explicitly.
 */
export default function GearRecords({ client, userId, chainring, cog }) {
  const contextHref = useContextHref()
  const gear = selectedGear(chainring, cog)
  const key = gear ? `${gear.chainring}x${gear.cog}` : ''
  const [state, setState] = useState({ loading: false, pbRecords: [], raceRecords: [], truncated: false, error: null })

  useEffect(() => {
    if (!userId || !gear) {
      setState({ loading: false, pbRecords: [], raceRecords: [], truncated: false, error: null })
      return undefined
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    fetchGearRecords(client, userId, gear.chainring, gear.cog).then((r) => {
      if (!cancelled) setState({ loading: false, ...r })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId, key])

  if (!userId || !gear) return null
  const { loading, pbRecords, raceRecords, truncated, error } = state
  const eventLabel = (r) => [r.event, r.venue].filter(Boolean).join(' · ') || '-'

  return (
    <div className={`${card} space-y-6`}>
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Records with {key}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Your PB Vault records and race rides that used this gear, including gears used in ride segments.
        </p>
      </div>
      {error && <p className="text-sm text-rose-500">Could not load records: {error.message}</p>}
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {!error && !loading && (
        <>
          <section>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">PB Vault</h3>
            {pbRecords.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No PB Vault records with this gear.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr><th className={th}>Date</th><th className={th}>Gear</th><th className={th}>Event / venue</th><th className={th}>Discipline</th><th className={th}>Time</th></tr>
                  </thead>
                  <tbody>
                    {pbRecords.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-surface-darkBorder">
                        <td className={td}>{formatDate(r.date)}</td>
                        <td className={`${td} font-bold`}>{r.gearLabel}</td>
                        <td className={td}><Link href={`/pb-vault/${r.id}`} className="hover:text-emerald-500">{eventLabel(r)}</Link></td>
                        <td className={td}>{r.discipline}</td>
                        <td className={`${td} font-bold`}>{formatTime(r.timeSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Race rides</h3>
            {raceRecords.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No race rides with this gear. Tag an activity as a race, or link it to a calendar race, to see it here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr><th className={th}>Date</th><th className={th}>Gear</th><th className={th}>Event / venue</th><th className={th}>Avg power</th><th className={th}>Max power</th><th className={th}>Time</th></tr>
                  </thead>
                  <tbody>
                    {raceRecords.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-surface-darkBorder">
                        <td className={td}>{formatDate(r.date)}</td>
                        <td className={`${td} font-bold`}>{r.gearLabel}{r.gearRole === 'segment' && <span className="ml-1 text-[10px] font-semibold text-slate-400">segment</span>}</td>
                        <td className={td}><Link href={contextHref(`/activities/${r.id}`)} className="hover:text-emerald-500">{eventLabel(r)}</Link></td>
                        <td className={td}>{r.avgPowerW != null ? `${Math.round(r.avgPowerW)} W` : '-'}</td>
                        <td className={`${td} font-bold`}>{r.maxPowerW != null ? `${Math.round(r.maxPowerW)} W` : '-'}</td>
                        <td className={td}>{r.timeSeconds != null ? formatElapsed(r.timeSeconds) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {truncated && <p className="mt-2 text-xs text-slate-400">Showing the most recent race rides only.</p>}
          </section>
        </>
      )}
    </div>
  )
}
