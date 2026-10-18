'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import RidersExplorer from '../../components/RidersExplorer'
import FollowPanel from '../../components/FollowPanel'
import DiscoverFeed from '../../components/DiscoverFeed'

const RIDER_TABS = [
  ['find', 'Find riders'],
  ['following', 'Following'],
  ['discover', 'Discover sessions'],
]

export default function RidersPage() {
  const [userId, setUserId] = useState(null)
  const [tab, setTab] = useState('find')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id ?? null))
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Riders</h1>
        <p className="text-xs text-slate-500">Find riders (and bots), manage who you follow and discover public sessions.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Riders sections">
        {RIDER_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
              tab === value ? 'bg-orange-500 text-white border-orange-500' : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {!userId ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : tab === 'find' ? (
        <RidersExplorer userId={userId} />
      ) : tab === 'following' ? (
        <FollowPanel userId={userId} />
      ) : (
        <DiscoverFeed userId={userId} />
      )}
    </div>
  )
}
