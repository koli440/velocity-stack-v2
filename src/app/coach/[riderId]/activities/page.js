'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { fetchProfilesByIds } from '../../../../lib/social'
import { fetchAthleteActivitiesPage } from '../../../../lib/coaching'
import { athletePath } from '../../../../lib/coachContext'
import ActivityFeed from '../../../../components/ActivityFeed'
import { useAthlete } from '../../../../components/AthleteContext'

export default function AthleteActivitiesPage() {
  const { riderId } = useAthlete()
  const [items, setItems] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [author, setAuthor] = useState(null)

  const load = useCallback(async (p) => {
    setBusy(true)
    const res = await fetchAthleteActivitiesPage(supabase, { riderId, page: p })
    setItems((prev) => (p === 0 ? res.data : [...prev, ...res.data]))
    setHasMore(res.hasMore)
    setPage(p)
    setBusy(false)
  }, [riderId])

  useEffect(() => {
    if (riderId) load(0)
  }, [riderId, load])

  useEffect(() => {
    if (riderId) fetchProfilesByIds(supabase, [riderId]).then(({ profiles }) => setAuthor(profiles.get(riderId) || null))
  }, [riderId])

  return (
    <ActivityFeed
      author={author}
      activities={items}
      title="Activities"
      hasMore={hasMore}
      isLoadingMore={busy && items.length > 0}
      onLoadMore={() => load(page + 1)}
      activityHref={(act) => athletePath(riderId, `/activities/${act.id}`)}
      emptyMessage={busy ? 'Loading…' : 'No activities yet.'}
    />
  )
}
