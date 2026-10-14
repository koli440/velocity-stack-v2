'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { followUser, unfollowUser, removeFollowRequest } from '../lib/social'
import { followButtonLabel } from '../lib/riders'

// Follow / Request / Requested / Unfollow for a rider, reusing the social.js actions
// (RLS enforces approval requirements and blocks).
export default function RiderFollowButton({ userId, rider, status, onStatusChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const label = followButtonLabel(rider, status)
  if (!label || !userId) return null

  const act = async () => {
    setBusy(true)
    setError(null)
    let result
    if (status === 'following') {
      result = await unfollowUser(supabase, { followerId: userId, followeeId: rider.id })
      if (!result.error) onStatusChange?.('none')
    } else if (status === 'requested') {
      result = await removeFollowRequest(supabase, { requesterId: userId, targetId: rider.id })
      if (!result.error) onStatusChange?.('none')
    } else {
      result = await followUser(supabase, {
        followerId: userId,
        followeeId: rider.id,
        requiresApproval: !!rider.require_follow_approval,
      })
      if (!result.error) onStatusChange?.(result.status)
    }
    if (result.error) setError(result.error.message)
    setBusy(false)
  }

  const primary = status === 'none' || !status
  return (
    <span className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        disabled={busy}
        onClick={act}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50 ${
          primary
            ? 'border-orange-500/40 text-orange-500 hover:bg-orange-500/10'
            : 'border-slate-300 dark:border-slate-700 text-slate-500'
        }`}
      >
        {label}
      </button>
      {error && <span className="text-[10px] text-rose-500">{error}</span>}
    </span>
  )
}
