'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import RidersExplorer from '../../components/RidersExplorer'

export default function RidersPage() {
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id ?? null))
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Riders</h1>
        <p className="text-xs text-slate-500">Find riders (and bots) to follow and see their sessions in your Following feed.</p>
      </div>
      {userId ? <RidersExplorer userId={userId} /> : <p className="text-xs text-slate-400">Loading…</p>}
    </div>
  )
}
