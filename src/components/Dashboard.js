'use client'

import SegmentedTabs from './SegmentedTabs'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
import Link from 'next/link'
import { fetchFollowingFeedPage, fetchProfilesByIds } from '../lib/social'
import { syncFeedData, syncFeedDataIfNeeded } from '../lib/feedSync'
import { fetchCoverPhotos } from '../lib/activityPhotos'
import { OPEN_ADD_SESSION_EVENT, ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import ActivityFeed from './ActivityFeed'
import EmptyFeedCard from './EmptyFeedCard'
import { stravaFlagMessage } from '../lib/emptyFeed'
import PowerProfileCard from './PowerProfileCard'
import WeekStatsCard from './WeekStatsCard'
import FitnessCard from './FitnessCard'
import OnboardingChecklist from './OnboardingChecklist'

export default function Dashboard({ initialActivities = [] }) {
  const [user, setUser] = useState(null)
  const [activities, setActivities] = useState(initialActivities)
  // Dynamic loading of activities (issue #46): with thousands of activities per user,
  // we only ever hold one page in memory at a time and fetch more on demand.
  const [hasMoreActivities, setHasMoreActivities] = useState(
    initialActivities.length === DEFAULT_ACTIVITIES_PAGE_SIZE
  )
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // Feed scope: own sessions or sessions shared by followed riders (issue #49).
  const [scope, setScope] = useState('mine')
  const [followingActivities, setFollowingActivities] = useState([])
  const [hasMoreFollowing, setHasMoreFollowing] = useState(false)
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false)
  const [coverPhotos, setCoverPhotos] = useState(new Map())
  const [activitiesLoaded, setActivitiesLoaded] = useState(initialActivities.length > 0)
  const [stravaNotice, setStravaNotice] = useState(null)
  const [ownProfile, setOwnProfile] = useState(null)

  // Result of the Strava OAuth round trip when it started from the welcome card (?strava=...).
  useEffect(() => {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('strava')
    if (!flag) return
    setStravaNotice(stravaFlagMessage(flag))
    url.searchParams.delete('strava')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

  // Signed cover-photo URLs for everything currently shown (one query + one signing call).
  useEffect(() => {
    const ids = [...activities, ...followingActivities].map((a) => a.id)
    if (!ids.length) return
    let cancelled = false
    fetchCoverPhotos(supabase, ids).then(({ covers, error }) => {
      if (!cancelled && !error) setCoverPhotos(covers)
    })
    return () => {
      cancelled = true
    }
  }, [activities, followingActivities])

  // Own profile so the rider avatar/name also show on the own feed.
  useEffect(() => {
    if (!user?.id) return
    fetchProfilesByIds(supabase, [user.id]).then(({ profiles }) => setOwnProfile(profiles.get(user.id) || null))
  }, [user?.id])

  const reloadFollowingFeed = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) return
    setIsLoadingFollowing(true)
    const { data, hasMore, error } = await fetchFollowingFeedPage(supabase, { userId: targetId, page: 0 })
    if (!error) {
      setFollowingActivities(data)
      setHasMoreFollowing(hasMore)
    }
    setIsLoadingFollowing(false)
  }

  const loadMoreFollowing = async () => {
    if (!user?.id || isLoadingFollowing || !hasMoreFollowing) return
    setIsLoadingFollowing(true)
    const page = Math.floor(followingActivities.length / DEFAULT_ACTIVITIES_PAGE_SIZE)
    const { data, hasMore, error } = await fetchFollowingFeedPage(supabase, { userId: user.id, page })
    if (!error) {
      setFollowingActivities((prev) => [...prev, ...data])
      setHasMoreFollowing(hasMore)
    }
    setIsLoadingFollowing(false)
  }

  // Resets back to the first page, e.g. after login or a sync/import.
  const reloadActivities = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) {
      setActivities([])
      setHasMoreActivities(false)
      return
    }

    const loadFirstPage = async () => {
      const { data, hasMore, error } = await fetchActivitiesPage(supabase, {
        userId: targetId,
        page: 0,
      })
      if (!error) {
        setActivities(data)
        setHasMoreActivities(hasMore)
        setActivitiesLoaded(true)
      }
    }

    // Show the feed right away; persist route previews + badges for anything new in the
    // background (only when something is pending) and refresh once if it changed anything.
    await loadFirstPage()
    syncFeedDataIfNeeded(supabase, targetId)
      .then((res) => (res.ran && (res.previews || res.badges) ? loadFirstPage() : null))
      .catch((err) => console.warn('Feed sync failed:', err))
  }

  // Fetches and appends the next page of activities for the current user.
  const loadMoreActivities = async () => {
    if (!user?.id || isLoadingMore || !hasMoreActivities) return

    setIsLoadingMore(true)
    try {
      const nextPage = Math.floor(activities.length / DEFAULT_ACTIVITIES_PAGE_SIZE)
      const { data, hasMore, error } = await fetchActivitiesPage(supabase, {
        userId: user.id,
        page: nextPage,
      })

      if (!error) {
        setActivities((prev) => [...prev, ...data])
        setHasMoreActivities(hasMore)
      }
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Imports/uploads/privacy-zone changes made from the top banner or settings refresh the feed.
  useEffect(() => {
    const handler = () => user?.id && reloadActivities(user.id)
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, handler)
    return () => window.removeEventListener(ACTIVITIES_CHANGED_EVENT, handler)
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        reloadActivities(session.user.id)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        reloadActivities(session.user.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
              Ride Telemetry
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live tracking & neuromuscular session analysis
            </p>
          </div>
        </div>

      <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* Main Cockpit */}
      <div className="flex-1 w-full min-w-0 space-y-6">
        <OnboardingChecklist />

        {/* Feed scope */}
        <SegmentedTabs
          label="Feed scope"
          tabs={[
            ['mine', 'My sessions'],
            ['following', 'Following'],
          ]}
          value={scope}
          onChange={(value) => {
            setScope(value)
            if (value === 'following') reloadFollowingFeed()
          }}
        />

        {scope === 'mine' ? (
          <>
          {activities.length === 0 && (
            <EmptyFeedCard
              userId={user?.id}
              activitiesLoaded={activitiesLoaded}
              activityCount={activities.length}
              onRefresh={() => user?.id && reloadActivities(user.id)}
              notice={stravaNotice}
            />
          )}
          <ActivityFeed
            key="mine"
            author={ownProfile}
            activities={activities}
            onAddWorkout={() => window.dispatchEvent(new Event(OPEN_ADD_SESSION_EVENT))}
            coverPhotos={coverPhotos}
            hasMore={hasMoreActivities}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreActivities}
          />
          </>
        ) : (
          <ActivityFeed
            key="following"
            title="Following"
            coverPhotos={coverPhotos}
            activities={followingActivities}
            hasMore={hasMoreFollowing}
            isLoadingMore={isLoadingFollowing}
            onLoadMore={loadMoreFollowing}
            emptyMessage={
              isLoadingFollowing ? (
                'Loading…'
              ) : (
                <>
                  Nothing here yet.{' '}
                  <Link href="/riders" className="font-bold text-orange-500 hover:text-orange-600">
                    Find riders to follow
                  </Link>{' '}
                  to see the sessions they share.
                </>
              )
            }
          />
        )}
      </div>

      {/* Right column */}
      <div className="w-full xl:w-80 shrink-0 space-y-3">
        <WeekStatsCard userId={user?.id} />
        <FitnessCard userId={user?.id} />
        <PowerProfileCard userId={user?.id} />
      </div>
      </div>
    </div>
  )
}
