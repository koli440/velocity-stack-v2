'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatTime } from '../../../../lib/pbVault'
import { useAthlete } from '../../../../components/AthleteContext'

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

  if (!rows) return <p className="text-xs text-slate-400">Loading…</p>
  return (
    <section className="space-y-2" data-testid="athlete-pbs">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        Personal bests{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      {rows.length === 0 && <p className="text-xs text-slate-500">No personal bests logged.</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <li key={r.id} className="py-2 text-xs flex justify-between gap-3">
            <span className="font-semibold">
              {r.discipline}
              <span className="text-slate-500 font-normal"> · {r.event_name || r.track_name || ''} · {r.achieved_date}</span>
            </span>
            <span className="font-mono shrink-0">
              {formatTime(Number(r.time_seconds))}
              {r.avg_speed_kmh ? ` · ${r.avg_speed_kmh} km/h` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
