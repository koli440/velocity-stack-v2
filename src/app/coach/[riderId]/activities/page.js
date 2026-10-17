'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
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

  return (
    <ActivityFeed
      activities={items}
      isOwnFeed
      title="Activities"
      hasMore={hasMore}
      isLoadingMore={busy && items.length > 0}
      onLoadMore={() => load(page + 1)}
      activityHref={(act) => athletePath(riderId, `/activities/${act.id}`)}
      emptyMessage={busy ? 'Loading…' : 'No activities yet.'}
    />
  )
}
