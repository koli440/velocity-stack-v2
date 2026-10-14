'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
import { syncFeedData, syncFeedDataIfNeeded } from '../lib/feedSync'
import { fetchFollowingFeedPage, fetchDiscoverFeedPage, fetchBlockedIds } from '../lib/social'
import FollowPanel from './FollowPanel'
import { fetchCoverPhotos } from '../lib/activityPhotos'
import { OPEN_ADD_SESSION_EVENT, ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import RosterPanel from './RosterPanel'
import ActivityFeed from './ActivityFeed'
import RidersExplorer from './RidersExplorer'

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
  const [discoverActivities, setDiscoverActivities] = useState([])
  const [hasMoreDiscover, setHasMoreDiscover] = useState(false)
  const [isLoadingDiscover, setIsLoadingDiscover] = useState(false)
  const [coverPhotos, setCoverPhotos] = useState(new Map())

  // Signed cover-photo URLs for everything currently shown (one query + one signing call).
  useEffect(() => {
    const ids = [...activities, ...followingActivities, ...discoverActivities].map((a) => a.id)
    if (!ids.length) return
    let cancelled = false
    fetchCoverPhotos(supabase, ids).then(({ covers, error }) => {
      if (!cancelled && !error) setCoverPhotos(covers)
    })
    return () => {
      cancelled = true
    }
  }, [activities, followingActivities, discoverActivities])

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

  const loadDiscover = async (page = 0) => {
    if (!user?.id) return
    setIsLoadingDiscover(true)
    const { ids: excludeIds } = await fetchBlockedIds(supabase, user.id)
    const { data, hasMore, error } = await fetchDiscoverFeedPage(supabase, {
      userId: user.id,
      excludeIds,
      page,
    })
    if (!error) {
      setDiscoverActivities((prev) => (page === 0 ? data : [...prev, ...data]))
      setHasMoreDiscover(hasMore)
    }
    setIsLoadingDiscover(false)
  }

  const reloadSocialFeeds = () => {
    if (scope === 'following') reloadFollowingFeed()
    if (scope === 'discover') loadDiscover(0)
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
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* Main Cockpit */}
      <div className="flex-1 w-full space-y-6">
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

        {/* Feed scope */}
        <div className="flex gap-2" role="tablist" aria-label="Feed scope">
          {[
            ['mine', 'My sessions'],
            ['following', 'Following'],
            ['discover', 'Discover'],
            ['riders', 'Riders'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => {
                setScope(value)
                if (value === 'following') reloadFollowingFeed()
                if (value === 'discover') loadDiscover(0)
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                scope === value
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'riders' ? (
          <RidersExplorer userId={user?.id} onFollowChanged={reloadSocialFeeds} />
        ) : scope === 'mine' ? (
          <ActivityFeed
            activities={activities}
            onAddWorkout={() => window.dispatchEvent(new Event(OPEN_ADD_SESSION_EVENT))}
            coverPhotos={coverPhotos}
            hasMore={hasMoreActivities}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreActivities}
          />
        ) : scope === 'discover' ? (
          <ActivityFeed
            title="Discover"
            isOwnFeed={false}
            coverPhotos={coverPhotos}
            activities={discoverActivities}
            hasMore={hasMoreDiscover}
            isLoadingMore={isLoadingDiscover}
            onLoadMore={() => loadDiscover(Math.ceil(discoverActivities.length / DEFAULT_ACTIVITIES_PAGE_SIZE))}
            emptyMessage={isLoadingDiscover ? 'Loading…' : 'No public sessions from other riders yet.'}
          />
        ) : (
          <ActivityFeed
            title="Following"
            isOwnFeed={false}
            coverPhotos={coverPhotos}
            activities={followingActivities}
            hasMore={hasMoreFollowing}
            isLoadingMore={isLoadingFollowing}
            onLoadMore={loadMoreFollowing}
            emptyMessage={
              isLoadingFollowing
                ? 'Loading…'
                : 'Nothing here yet. Follow riders in the Riders panel to see the sessions they share.'
            }
          />
        )}
      </div>

      {/* Right panel */}
      <div className="w-full xl:w-80 shrink-0 space-y-3">
        <FollowPanel userId={user?.id} onChanged={reloadSocialFeeds} />

        <RosterPanel />
      </div>
    </div>
  )
}