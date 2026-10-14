'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { fetchRiderProfile, riderName, formatLastActive, formatRideCount } from '../../../lib/riders'
import { SHARED_FEED_COLUMNS } from '../../../lib/activityPagination'
import BotBadge from '../../../components/BotBadge'
import Avatar from '../../../components/Avatar'
import RiderFollowButton from '../../../components/RiderFollowButton'
import ActivityFeed from '../../../components/ActivityFeed'

export default function RiderProfilePage() {
  const { id } = useParams()
  const [userId, setUserId] = useState(null)
  const [rider, setRider] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadActivities = async (profile) => {
    // RLS / shared_activities decide what the viewer may see (public, followers-only if following).
    const { data } = await supabase
      .from('shared_activities')
      .select(SHARED_FEED_COLUMNS)
      .eq('user_id', id)
      .neq('visibility', 'private')
      .order('activity_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(20)
    setActivities((data || []).map((a) => ({ ...a, author: { id, display_name: profile.display_name, is_bot: profile.is_bot, avatar_url: profile.avatar_url } })))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setUserId(session?.user?.id ?? null)
      const { rider: profile, error: err } = await fetchRiderProfile(supabase, id)
      if (cancelled) return
      if (err) setError('Could not load rider')
      setRider(profile)
      if (profile) await loadActivities(profile)
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const changeStatus = async (status) => {
    const { rider: fresh } = await fetchRiderProfile(supabase, id)
    setRider(fresh ? { ...fresh, follow_status: status } : rider)
    if (fresh) await loadActivities(fresh)
  }

  if (loading) return <p className="text-xs text-slate-400">Loading…</p>

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link href="/riders" className="text-xs font-bold text-slate-500 hover:text-orange-500">← All riders</Link>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {!rider ? (
        <p className="text-sm text-slate-500">Rider not found.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder">
            <Avatar url={rider.avatar_url} name={riderName(rider)} size="w-14 h-14" textSize="text-xl" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white truncate">{riderName(rider)}</h1>
                {rider.is_bot && <BotBadge />}
              </div>
              <p className="text-xs text-slate-500">
                <strong>{rider.follower_count}</strong> followers · <strong>{rider.following_count}</strong> following ·{' '}
                {formatRideCount(rider.ride_count)}
              </p>
              <p className="text-[11px] text-slate-500">
                {rider.home_track_name ? `${rider.home_track_name} · ` : ''}
                {formatLastActive(rider.last_activity_date)}
              </p>
            </div>
            <RiderFollowButton userId={userId} rider={rider} status={rider.follow_status} onStatusChange={changeStatus} />
          </div>
          <ActivityFeed
            title="Recent sessions"
            isOwnFeed={false}
            activities={activities}
            emptyMessage="No sessions shared with you yet."
          />
        </>
      )}
    </div>
  )
}
