'use client'

import SegmentedTabs from './SegmentedTabs'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
import Link from 'next/link'
import { fetchFollowingFeedPage, fetchProfilesByIds } from '../lib/social'
import { syncFeedData, syncFeedDataIfNeeded } from '../lib/feedSync'
import { fetchCoverPhotos } from '../lib/activityPhotos'
import { OPEN_ADD_SESSION_EVENT, ACTIVITIES_CHANGED_EVENT } from '../lib/navigation'
import ActivityFeed from './ActivityFeed'
import { scopeFromSearch, feedPath, snapshotKey, buildSnapshot, parseSnapshot } from '../lib/feedRestore'
import EmptyFeedCard from './EmptyFeedCard'
import { stravaFlagMessage } from '../lib/emptyFeed'
import PowerProfileCard from './PowerProfileCard'
import WeekStatsCard from './WeekStatsCard'
import FitnessCard from './FitnessCard'
import OnboardingChecklist from './OnboardingChecklist'
import { withOwnAuthorAvatar } from '../lib/blogFeed'
import { BLOG_AUTHOR } from '../lib/blog'

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
  // Tab, loaded depth and scroll to restore when coming back from an activity (see lib/feedRestore).
  const restoreRef = useRef({ depth: { mine: 0, following: 0 }, scrollY: 0, scope: 'mine', pending: false })
  const liveRef = useRef({})
  const followingInit = useRef(false)
  const [followingActivities, setFollowingActivities] = useState([])
  const [hasMoreFollowing, setHasMoreFollowing] = useState(false)
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false)
  const [coverPhotos, setCoverPhotos] = useState(new Map())
  const [activitiesLoaded, setActivitiesLoaded] = useState(initialActivities.length > 0)
  const [stravaNotice, setStravaNotice] = useState(null)
  const [ownProfile, setOwnProfile] = useState(null)
  const [blogCards, setBlogCards] = useState([])

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

  // Published blog posts (public content) shown as timeline cards in the own feed; failures just hide them.
  useEffect(() => {
    let cancelled = false
    fetch('/api/blog-cards')
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((j) => !cancelled && setBlogCards(Array.isArray(j.cards) ? j.cards : []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Own profile so the rider avatar/name also show on the own feed.
  useEffect(() => {
    if (!user?.id) return
    fetchProfilesByIds(supabase, [user.id]).then(({ profiles }) => setOwnProfile(profiles.get(user.id) || null))
  }, [user?.id])

  // Loads further pages after the first until `target` items are present (used to restore feed depth).
  const loadToDepth = async (first, target, fetchPage) => {
    let data = first.data
    let hasMore = first.hasMore
    while (hasMore && data.length < target) {
      const next = await fetchPage(Math.floor(data.length / DEFAULT_ACTIVITIES_PAGE_SIZE))
      if (next.error) break
      data = [...data, ...next.data]
      hasMore = next.hasMore
    }
    return { data, hasMore }
  }

  // Scrolls back to the saved position once, after the restored feed has rendered.
  const applyScrollRestore = (forScope) => {
    const r = restoreRef.current
    if (!r.pending || r.scope !== forScope) return
    r.pending = false
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, r.scrollY)))
  }

  const reloadFollowingFeed = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) return
    setIsLoadingFollowing(true)
    const fetchPage = (page) => fetchFollowingFeedPage(supabase, { userId: targetId, page })
    const first = await fetchPage(0)
    if (!first.error) {
      const { data, hasMore } = await loadToDepth(first, restoreRef.current.depth.following, fetchPage)
      setFollowingActivities(data)
      setHasMoreFollowing(hasMore)
      applyScrollRestore('following')
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
      const fetchPage = (page) => fetchActivitiesPage(supabase, { userId: targetId, page })
      const first = await fetchPage(0)
      if (!first.error) {
        const { data, hasMore } = await loadToDepth(first, restoreRef.current.depth.mine, fetchPage)
        setActivities(data)
        setHasMoreActivities(hasMore)
        setActivitiesLoaded(true)
        applyScrollRestore('mine')
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

  liveRef.current = { scope, count: scope === 'following' ? followingActivities.length : activities.length }

  // Tab from the URL + saved snapshot (read before the first feed load so depth is restored).
  useEffect(() => {
    const initial = scopeFromSearch(window.location.search)
    const snap = parseSnapshot(window.sessionStorage.getItem(snapshotKey(initial)))
    restoreRef.current = {
      depth: { mine: 0, following: 0, [initial]: snap ? snap.count : 0 },
      scrollY: snap ? snap.scrollY : 0,
      scope: initial,
      pending: Boolean(snap),
    }
    if (initial !== 'mine') setScope(initial)
    window.sessionStorage.removeItem(snapshotKey(initial))
  }, [])

  useEffect(() => {
    if (scope === 'following' && user?.id && !followingInit.current) {
      followingInit.current = true
      reloadFollowingFeed(user.id)
    }
  }, [scope, user?.id])

  // Remember depth + scroll of the current tab when an activity is opened from the feed.
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target?.closest?.('a[href^="/activities/"]')
      if (!a) return
      const { scope: s, count } = liveRef.current
      try {
        window.sessionStorage.setItem(snapshotKey(s), buildSnapshot({ count, scrollY: window.scrollY }))
      } catch {}
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

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
            window.sessionStorage.removeItem(snapshotKey(value))
            window.history.replaceState(window.history.state, '', feedPath(value))
            if (value === 'following') {
              followingInit.current = true
              reloadFollowingFeed()
            }
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
            returnTo={feedPath('mine')}
            author={ownProfile}
            activities={activities}
            onAddWorkout={() => window.dispatchEvent(new Event(OPEN_ADD_SESSION_EVENT))}
            coverPhotos={coverPhotos}
            blogCards={activitiesLoaded ? withOwnAuthorAvatar(blogCards, ownProfile, BLOG_AUTHOR.name) : null}
            hasMore={hasMoreActivities}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreActivities}
          />
          </>
        ) : (
          <ActivityFeed
            key="following"
            returnTo={feedPath('following')}
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
      {/* Always above the feed on narrow screens (the infinite feed would make it unreachable below); compact there */}
      <div
        data-testid="dashboard-side-column"
        className="w-full xl:w-80 shrink-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 xl:gap-0 xl:space-y-3 order-first xl:order-last min-w-0"
      >
        <WeekStatsCard userId={user?.id} />
        <FitnessCard userId={user?.id} />
        <div className="sm:col-span-2 xl:col-span-1 min-w-0">
          <PowerProfileCard userId={user?.id} />
        </div>
      </div>
      </div>
    </div>
  )
}
