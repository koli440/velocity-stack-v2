'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import {
  RIDERS_PAGE_SIZE,
  RIDER_SEARCH_DEBOUNCE_MS,
  fetchRidersPage,
  mergeRiderPages,
  riderName,
  formatLastActive,
  formatRideCount,
} from '../lib/riders'
import BotBadge from './BotBadge'
import Avatar from './Avatar'
import RiderFollowButton from './RiderFollowButton'

// Shared hook: debounced search + "bots only" filter + offset pagination.
export function useRiderDiscovery() {
  const [term, setTerm] = useState('')
  const [botsOnly, setBotsOnly] = useState(false)
  const [riders, setRiders] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const requestId = useRef(0)
  const loadingRef = useRef(false)
  const state = useRef({ riders: [], hasMore: false })

  const load = useCallback(async (reset, currentTerm, currentBotsOnly) => {
    if (loadingRef.current && !reset) return
    const id = ++requestId.current
    loadingRef.current = true
    setLoading(true)
    const offset = reset ? 0 : state.current.riders.length
    const res = await fetchRidersPage(supabase, { term: currentTerm, botsOnly: currentBotsOnly, offset })
    if (id !== requestId.current) return // a newer request superseded this one
    loadingRef.current = false
    setLoading(false)
    if (res.error) {
      setError('Could not load riders')
      return
    }
    setError(null)
    const next = reset ? res.riders : mergeRiderPages(state.current.riders, res.riders)
    state.current = { riders: next, hasMore: res.hasMore }
    setRiders(next)
    setHasMore(res.hasMore)
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => load(true, term, botsOnly), term ? RIDER_SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(handle)
  }, [term, botsOnly, load])

  const loadMore = useCallback(() => {
    if (state.current.hasMore) load(false, term, botsOnly)
  }, [load, term, botsOnly])

  const setStatus = useCallback((riderId, status) => {
    const next = state.current.riders.map((r) => (r.id === riderId ? { ...r, follow_status: status } : r))
    state.current = { ...state.current, riders: next }
    setRiders(next)
  }, [])

  return { term, setTerm, botsOnly, setBotsOnly, riders, hasMore, loading, error, loadMore, setStatus }
}

export function RiderCard({ rider, userId, onStatusChange }) {
  return (
    <li className="flex items-center gap-3 p-3 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder">
      <Avatar url={rider.avatar_url} name={riderName(rider)} size="w-10 h-10" textSize="text-sm" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/riders/${rider.id}`}
            className="text-sm font-black text-slate-900 dark:text-white hover:text-orange-500 truncate"
          >
            {riderName(rider)}
          </Link>
          {rider.is_bot && <BotBadge />}
        </div>
        <p className="text-[11px] text-slate-500 truncate">
          {rider.home_track_name ? `${rider.home_track_name} · ` : ''}
          {formatLastActive(rider.last_activity_date)} · {formatRideCount(rider.ride_count)}
        </p>
      </div>
      <RiderFollowButton
        userId={userId}
        rider={rider}
        status={rider.follow_status}
        onStatusChange={(s) => onStatusChange(rider.id, s)}
      />
    </li>
  )
}

// Searchable, infinitely scrolling rider list. Used by the "Find riders" tab of the
// /riders page.
export default function RidersExplorer({ userId, onFollowChanged }) {
  const { term, setTerm, botsOnly, setBotsOnly, riders, hasMore, loading, error, loadMore, setStatus } =
    useRiderDiscovery()
  const sentinel = useRef(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore, riders.length])

  const handleStatus = (id, status) => {
    setStatus(id, status)
    onFollowChanged?.()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by nickname, name or exact e-mail…"
          aria-label="Search riders"
          className="flex-1 min-w-[12rem] px-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        />
        <button
          type="button"
          aria-pressed={botsOnly}
          onClick={() => setBotsOnly(!botsOnly)}
          className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
            botsOnly ? 'bg-orange-500 text-white border-orange-500' : 'border-slate-200 dark:border-slate-800 text-slate-500'
          }`}
        >
          Bots
        </button>
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <ul className="space-y-2">
        {riders.map((r) => (
          <RiderCard key={r.id} rider={r} userId={userId} onStatusChange={handleStatus} />
        ))}
      </ul>
      {!loading && !error && riders.length === 0 && (
        <p className="text-sm text-slate-500">No riders found.</p>
      )}
      {loading && <p className="text-xs text-slate-400">Loading…</p>}
      {hasMore && !loading && (
        <>
          <div ref={sentinel} aria-hidden="true" className="h-1" />
          <button
            type="button"
            onClick={loadMore}
            className="w-full py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-orange-500"
          >
            Load more
          </button>
        </>
      )}
    </div>
  )
}
