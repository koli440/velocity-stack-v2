'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import RidersExplorer from '../../components/RidersExplorer'
import FollowPanel from '../../components/FollowPanel'
import SegmentedTabs from '../../components/SegmentedTabs'

const RIDER_TABS = [
  ['find', 'Find riders'],
  ['following', 'Following'],
]

function RidersContent() {
  const [userId, setUserId] = useState(null)
  const requested = useSearchParams().get('tab')
  const [tab, setTab] = useState(RIDER_TABS.some(([key]) => key === requested) ? requested : 'find')

  useEffect(() => {
    if (RIDER_TABS.some(([key]) => key === requested)) setTab(requested)
  }, [requested])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id ?? null))
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Riders</h1>
        <p className="text-xs text-slate-500">Find riders (and bots), manage who you follow and manage who you follow.</p>
      </div>
      <SegmentedTabs label="Riders sections" tabs={RIDER_TABS} value={tab} onChange={setTab} />
      {!userId ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : tab === 'find' ? (
        <RidersExplorer userId={userId} />
      ) : (
        <FollowPanel userId={userId} />
      )}
    </div>
  )
}

export default function RidersPage() {
  return (
    <Suspense fallback={null}>
      <RidersContent />
    </Suspense>
  )
}
