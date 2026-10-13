'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  searchRiders,
  followUser,
  unfollowUser,
  fetchFollowingIds,
  fetchProfilesByIds,
  authorName,
} from '../lib/social'

// Find riders and manage who you follow (issue #49).
export default function FollowPanel({ userId, onChanged }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [following, setFollowing] = useState([])
  const [error, setError] = useState(null)

  const loadFollowing = async () => {
    const { ids } = await fetchFollowingIds(supabase, userId)
    const { profiles } = await fetchProfilesByIds(supabase, ids)
    setFollowing(ids.map((id) => profiles.get(id) || { id }))
  }

  useEffect(() => {
    if (userId) loadFollowing()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const handle = setTimeout(async () => {
      const { riders, error: searchError } = await searchRiders(supabase, { term, excludeId: userId })
      setResults(riders)
      setError(searchError ? 'Search failed' : null)
    }, 300)
    return () => clearTimeout(handle)
  }, [term, userId])

  const isFollowing = (id) => following.some((f) => f.id === id)

  const toggle = async (rider) => {
    const fn = isFollowing(rider.id) ? unfollowUser : followUser
    const { error: actionError } = await fn(supabase, { followerId: userId, followeeId: rider.id })
    if (actionError) {
      setError(actionError.message)
      return
    }
    await loadFollowing()
    onChanged?.()
  }

  if (!userId) return null

  const Row = ({ rider }) => (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{authorName(rider)}</span>
      <button
        type="button"
        onClick={() => toggle(rider)}
        className={`shrink-0 px-2 py-1 rounded-lg font-bold border transition ${
          isFollowing(rider.id)
            ? 'border-slate-300 dark:border-slate-700 text-slate-500'
            : 'border-orange-500/40 text-orange-500 hover:bg-orange-500/10'
        }`}
      >
        {isFollowing(rider.id) ? 'Unfollow' : 'Follow'}
      </button>
    </li>
  )

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Riders</h3>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Find riders by name…"
        aria-label="Find riders"
        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
      />
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <Row key={r.id} rider={r} />
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase text-slate-400">Following ({following.length})</p>
        <ul className="space-y-2">
          {following.map((r) => (
            <Row key={r.id} rider={r} />
          ))}
        </ul>
      </div>
    </div>
  )
}
