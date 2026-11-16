'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatTime } from '../../../../lib/pbVault'
import { useAthlete } from '../../../../components/AthleteContext'
import { adminCard, adminMuted } from '../../../../components/admin/AdminUi'

// Read-only: coach access to personal bests is SELECT-only (see the coach RLS policies).
export default function AthletePbVaultPage() {
  const { riderId, athlete } = useAthlete()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!riderId) return
    supabase
      .from('personal_bests')
      .select('id, discipline, track_name, event_name, achieved_date, time_seconds, avg_speed_kmh')
      .eq('user_id', riderId)
      .order('achieved_date', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [riderId])

  if (!rows) return <p className={`text-sm ${adminMuted}`} role="status">Loading…</p>
  return (
    <section className="space-y-4" data-testid="athlete-pbs">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">
        Personal bests{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      {rows.length === 0 && <p className={`${adminCard} text-sm ${adminMuted} text-center`}>No personal bests logged.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`${adminCard} !p-3 text-sm flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-3`}>
            <span className="font-bold text-slate-900 dark:text-white">
              {r.discipline}
              <span className="text-slate-600 dark:text-slate-300 font-normal"> · {r.event_name || r.track_name || ''} · {r.achieved_date}</span>
            </span>
            <span className="font-mono shrink-0 text-slate-800 dark:text-slate-200">
              {formatTime(Number(r.time_seconds))}
              {r.avg_speed_kmh ? ` · ${r.avg_speed_kmh} km/h` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
