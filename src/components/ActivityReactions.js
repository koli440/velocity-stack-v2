'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { authorName } from '../lib/social'
import {
  fetchReactionInfo,
  fetchReactors,
  reactionErrorMessage,
  reactorSummary,
  setActivityReaction,
  toggledState,
} from '../lib/activityReactions'
import ReactionButton from './ReactionButton'

// Respect button + count on the activity page; the owner also sees who reacted.
export default function ActivityReactions({ activityId }) {
  const [info, setInfo] = useState(null)
  const [reactors, setReactors] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { info: map } = await fetchReactionInfo(supabase, [activityId])
    const row = map.get(activityId) || null
    setInfo(row)
    if (row?.is_owner && row.reaction_count > 0) {
      const { reactors: list } = await fetchReactors(supabase, activityId)
      setReactors(list)
    } else {
      setReactors([])
    }
  }, [activityId])

  useEffect(() => {
    load()
  }, [load])

  if (!info) return null
  const count = info.reaction_count || 0
  if (!info.can_react && !count) return null

  const toggle = async () => {
    setBusy(true)
    setError('')
    const prev = { count, reacted: info.i_reacted }
    const next = toggledState(prev)
    setInfo({ ...info, reaction_count: next.count, i_reacted: next.reacted })
    const { error: err } = await setActivityReaction(supabase, { activityId, on: next.reacted })
    if (err) {
      setInfo({ ...info, reaction_count: prev.count, i_reacted: prev.reacted })
      setError(reactionErrorMessage(err))
    } else {
      load()
    }
    setBusy(false)
  }

  const names = reactors.map((r) => authorName(r.profile))

  return (
    <div data-testid="activity-reactions" className="flex flex-wrap items-center gap-3 [&>button]:w-full sm:[&>button]:w-auto">
      <ReactionButton size="md" count={count} reacted={info.i_reacted} canReact={info.can_react} busy={busy} onToggle={toggle} />
      {info.is_owner && count > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="reactors-line">
          {reactorSummary(names, count)} gave respect
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
