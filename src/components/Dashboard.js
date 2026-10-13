'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { deleteActivity } from '../lib/activityActions'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
import { syncFeedData } from '../lib/feedSync'
import { fetchFollowingFeedPage, fetchDiscoverFeedPage, fetchBlockedIds, setActivityVisibility } from '../lib/social'
import FollowPanel from './FollowPanel'
import NotificationBell from './NotificationBell'
import PrivacyZonePanel from './PrivacyZonePanel'
import { fetchCoverPhotos, removeActivityPhotoFiles } from '../lib/activityPhotos'
import RosterPanel from './RosterPanel'
import TelemetryCards from './TelemetryCards'
import FitUploader from './FitUploader'
import ActivityFeed from './ActivityFeed'
import IntervalsSyncModal from './IntervalsSyncModal'
import BulkImportModal from './BulkImportModal'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [activities, setActivities] = useState(initialActivities)
  const [currentTracks, setCurrentTracks] = useState(tracks)
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false)
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

  const handleChangeVisibility = async (activity, visibility) => {
    const { error } = await setActivityVisibility(supabase, { activityId: activity.id, visibility })
    if (error) {
      alert('Could not change visibility: ' + error.message)
      return
    }
    setActivities((prev) => prev.map((a) => (a.id === activity.id ? { ...a, visibility } : a)))
  }

  // Resets back to the first page, e.g. after login or a sync/import.
  const reloadActivities = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) {
      setActivities([])
      setHasMoreActivities(false)
      return
    }

    // Persist route previews + badges for anything new before reading the feed back.
    await syncFeedData(supabase, targetId).catch((err) => console.warn('Feed sync failed:', err))

    const { data, hasMore, error } = await fetchActivitiesPage(supabase, {
      userId: targetId,
      page: 0,
    })

    if (!error) {
      setActivities(data)
      setHasMoreActivities(hasMore)
    }
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

  // Permanent deletion of the activity (issue #18): removes the record from activities (cascading
  // to linked curves/template_executions) and any archived .fit file from Storage.
  const handleDeleteActivity = async (activity) => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete activity "${activity.title || 'Velodrome Session'}"? This action cannot be undone.`
    )
    if (!confirmed) return

    await removeActivityPhotoFiles(supabase, activity.id).catch(() => {})
    const { error } = await deleteActivity(supabase, activity)
    if (error) {
      alert('Error while deleting activity: ' + error.message)
      return
    }

    setActivities((prev) => prev.filter((a) => a.id !== activity.id))
    // Deleting changes records/milestones of later sessions.
    if (user?.id) syncFeedData(supabase, user.id).then(() => reloadActivities(user.id))
  }

  const latestActivity = activities[0] || null

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
          <NotificationBell userId={user?.id} />
        </div>

        {/* Telemetry tiles */}
        <TelemetryCards lastActivity={latestActivity} />

        {/* Feed scope */}
        <div className="flex gap-2" role="tablist" aria-label="Feed scope">
          {[
            ['mine', 'My sessions'],
            ['following', 'Following'],
            ['discover', 'Discover'],
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

        {scope === 'mine' ? (
          <ActivityFeed
            activities={activities}
            onAddWorkout={() => setIsWorkoutModalOpen(true)}
            onDeleteActivity={handleDeleteActivity}
            onChangeVisibility={handleChangeVisibility}
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
        <button
          onClick={() => router.push('/gears')}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-bold transition border border-sky-500/30 shadow-xs"
        >
          <span>🔧</span> Gear Architect
        </button>

        <button
          onClick={() => router.push('/pursuit')}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold transition border border-amber-500/30 shadow-xs"
        >
          <span>⏱️</span> Pursuit Strategist
        </button>

        <button
          onClick={() => router.push('/pb-vault')}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold transition border border-amber-500/30 shadow-xs"
        >
          <span>🏆</span> PB Vault
        </button>

        <button
          onClick={() => setIsSyncModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-bold transition border border-purple-500/30 shadow-xs"
        >
          <span>🔄</span> Sync Intervals.icu
        </button>

        <button
          onClick={() => setIsBulkImportModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold transition border border-emerald-500/30 shadow-xs"
        >
          <span>📦</span> Import History
        </button>

        <button
          onClick={() => router.push('/aero-lab')}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 text-xs font-bold transition border border-sky-500/30 shadow-xs"
        >
          <span>🧪</span> Aero Lab
        </button>

        <FollowPanel userId={user?.id} onChanged={reloadSocialFeeds} />

        <PrivacyZonePanel userId={user?.id} onChanged={() => reloadActivities(user.id)} />

        <RosterPanel onAddWorkout={() => setIsWorkoutModalOpen(true)} />
      </div>

      {/* Modal for manual .FIT file upload */}
      {isWorkoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <FitUploader
              tracks={currentTracks}
              currentUser={user}
              onClose={() => setIsWorkoutModalOpen(false)}
              onSaved={(newId) => {
                setIsWorkoutModalOpen(false)
                if (newId) {
                  router.push(`/activities/${newId}`)
                } else if (user?.id) {
                  reloadActivities(user.id)
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Modal for selecting and importing from Intervals.icu */}
      <IntervalsSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        currentUser={user}
        tracks={currentTracks}
        onImportSuccess={(newActivityId) => {
          setIsSyncModalOpen(false)
          if (newActivityId) {
            router.push(`/activities/${newActivityId}`)
          } else if (user?.id) {
            reloadActivities(user.id)
          }
        }}
      />

      {/* Modal for bulk-importing a historical .zip/.fit archive (issue #36) */}
      {isBulkImportModalOpen && (
        <BulkImportModal
          isOpen={isBulkImportModalOpen}
          onClose={() => setIsBulkImportModalOpen(false)}
          currentUser={user}
          tracks={currentTracks}
          onImportComplete={() => {
            if (user?.id) reloadActivities(user.id)
          }}
        />
      )}
    </div>
  )
}