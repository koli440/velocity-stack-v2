'use client'

import BotBadge from './BotBadge'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  searchRiders,
  followUser,
  unfollowUser,
  blockUser,
  unblockUser,
  fetchFollowingIds,
  fetchFollowerIds,
  fetchFollowCounts,
  fetchBlockedIds,
  fetchIncomingRequestIds,
  fetchOutgoingRequestIds,
  approveFollowRequest,
  removeFollowRequest,
  fetchRequireFollowApproval,
  setRequireFollowApproval,
  fetchProfilesByIds,
  authorName,
} from '../lib/social'

function SmallButton({ onClick, children, tone = 'default' }) {
  const tones = {
    default: 'border-slate-300 dark:border-slate-700 text-slate-500',
    primary: 'border-orange-500/40 text-orange-500 hover:bg-orange-500/10',
    danger: 'border-rose-500/30 text-rose-500 hover:bg-rose-500/10',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-bold border transition ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

function Row({ rider, children }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{authorName(rider)}</span>
      {rider?.is_bot && <BotBadge />}
      <span className="flex gap-1 ml-auto">{children}</span>
    </li>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase text-slate-400">{title}</p>
      <ul className="space-y-2">{children}</ul>
    </div>
  )
}

// Find riders, handle follow requests, and manage followers / following / blocked riders
// (issue #49).
export default function FollowPanel({ userId, onChanged }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [following, setFollowing] = useState([])
  const [followers, setFollowers] = useState([])
  const [blocked, setBlocked] = useState([])
  const [incoming, setIncoming] = useState([])
  const [outgoingIds, setOutgoingIds] = useState([])
  const [counts, setCounts] = useState({ followers: 0, following: 0 })
  const [requireApproval, setRequireApproval] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    const [f, fr, b, inc, out, c, setting] = await Promise.all([
      fetchFollowingIds(supabase, userId),
      fetchFollowerIds(supabase, userId),
      fetchBlockedIds(supabase, userId),
      fetchIncomingRequestIds(supabase, userId),
      fetchOutgoingRequestIds(supabase, userId),
      fetchFollowCounts(supabase, userId),
      fetchRequireFollowApproval(supabase, userId),
    ])
    const { profiles } = await fetchProfilesByIds(supabase, [...f.ids, ...fr.ids, ...b.ids, ...inc.ids])
    const toProfiles = (ids) => ids.map((id) => profiles.get(id) || { id })
    setFollowing(toProfiles(f.ids))
    setFollowers(toProfiles(fr.ids))
    setBlocked(toProfiles(b.ids))
    setIncoming(toProfiles(inc.ids))
    setOutgoingIds(out.ids)
    setCounts({ followers: c.followers, following: c.following })
    setRequireApproval(setting.value)
  }

  useEffect(() => {
    if (userId) load()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const handle = setTimeout(async () => {
      const { riders, error: searchError } = await searchRiders(supabase, {
        term,
        excludeId: userId,
        excludeIds: blocked.map((b) => b.id),
      })
      setResults(riders)
      setError(searchError ? 'Search failed' : null)
    }, 300)
    return () => clearTimeout(handle)
  }, [term, userId, blocked])

  const isFollowing = (id) => following.some((f) => f.id === id)
  const isRequested = (id) => outgoingIds.includes(id)

  const run = async (action) => {
    const { error: actionError } = await action()
    if (actionError) {
      setError(actionError.message)
      return
    }
    setError(null)
    await load()
    onChanged?.()
  }

  const toggleFollow = (rider) => {
    if (isFollowing(rider.id)) return run(() => unfollowUser(supabase, { followerId: userId, followeeId: rider.id }))
    if (isRequested(rider.id)) return run(() => removeFollowRequest(supabase, { requesterId: userId, targetId: rider.id }))
    return run(() =>
      followUser(supabase, {
        followerId: userId,
        followeeId: rider.id,
        requiresApproval: !!rider.require_follow_approval,
      })
    )
  }

  const followLabel = (rider) =>
    isFollowing(rider.id) ? 'Unfollow' : isRequested(rider.id) ? 'Requested' : rider.require_follow_approval ? 'Request' : 'Follow'

  const confirmBlock = (rider) => {
    if (!window.confirm(`Block ${authorName(rider)}? They will no longer see your activities and can't follow you.`)) return
    return run(() => blockUser(supabase, { blockerId: userId, blockedId: rider.id }))
  }

  if (!userId) return null

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Riders</h3>
      <p className="text-[11px] text-slate-500">
        <strong>{counts.followers}</strong> followers · <strong>{counts.following}</strong> following
      </p>
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
            <Row key={r.id} rider={r}>
              <SmallButton tone={isFollowing(r.id) || isRequested(r.id) ? 'default' : 'primary'} onClick={() => toggleFollow(r)}>
                {followLabel(r)}
              </SmallButton>
            </Row>
          ))}
        </ul>
      )}

      <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={requireApproval}
          onChange={(e) => run(() => setRequireFollowApproval(supabase, { userId, value: e.target.checked }))}
        />
        <span>Require my approval for new followers (existing followers are kept)</span>
      </label>

      {incoming.length > 0 && (
        <Section title={`Follow requests (${incoming.length})`}>
          {incoming.map((r) => (
            <Row key={r.id} rider={r}>
              <SmallButton tone="primary" onClick={() => run(() => approveFollowRequest(supabase, { requesterId: r.id }))}>
                Approve
              </SmallButton>
              <SmallButton onClick={() => run(() => removeFollowRequest(supabase, { requesterId: r.id, targetId: userId }))}>
                Decline
              </SmallButton>
            </Row>
          ))}
        </Section>
      )}

      <Section title={`Following (${following.length})`}>
        {following.map((r) => (
          <Row key={r.id} rider={r}>
            <SmallButton onClick={() => toggleFollow(r)}>Unfollow</SmallButton>
          </Row>
        ))}
      </Section>

      <Section title={`Followers (${followers.length})`}>
        {followers.map((r) => (
          <Row key={r.id} rider={r}>
            <SmallButton tone="danger" onClick={() => confirmBlock(r)}>
              Block
            </SmallButton>
          </Row>
        ))}
      </Section>

      {blocked.length > 0 && (
        <Section title={`Blocked (${blocked.length})`}>
          {blocked.map((r) => (
            <Row key={r.id} rider={r}>
              <SmallButton onClick={() => run(() => unblockUser(supabase, { blockerId: userId, blockedId: r.id }))}>
                Unblock
              </SmallButton>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}
