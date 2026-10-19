'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
import { fetchDiscoverFeedPage, fetchBlockedIds } from '../lib/social'
import { fetchCoverPhotos } from '../lib/activityPhotos'
import ActivityFeed from './ActivityFeed'

// Public sessions from other riders (infinite scroll). Lives on the /riders page.
export default function DiscoverFeed({ userId }) {
  const [activities, setActivities] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [coverPhotos, setCoverPhotos] = useState(new Map())

  const load = useCallback(
    async (page = 0) => {
      if (!userId) return
      setIsLoading(true)
      const { ids: excludeIds } = await fetchBlockedIds(supabase, userId)
      const { data, hasMore: more, error } = await fetchDiscoverFeedPage(supabase, { userId, excludeIds, page })
      if (!error) {
        setActivities((prev) => (page === 0 ? data : [...prev, ...data]))
        setHasMore(more)
      }
      setIsLoading(false)
    },
    [userId]
  )

  useEffect(() => {
    load(0)
  }, [load])

  useEffect(() => {
    const ids = activities.map((a) => a.id)
    if (!ids.length) return
    let cancelled = false
    fetchCoverPhotos(supabase, ids).then(({ covers, error }) => {
      if (!cancelled && !error) setCoverPhotos(covers)
    })
    return () => {
      cancelled = true
    }
  }, [activities])

  return (
    <ActivityFeed
      key="discover"
      title="Discover"
      coverPhotos={coverPhotos}
      activities={activities}
      hasMore={hasMore}
      isLoadingMore={isLoading}
      onLoadMore={() => !isLoading && load(Math.ceil(activities.length / DEFAULT_ACTIVITIES_PAGE_SIZE))}
      emptyMessage={isLoading ? 'Loading…' : 'No public sessions from other riders yet.'}
    />
  )
}
