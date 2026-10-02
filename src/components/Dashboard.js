'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { deleteActivity } from '../lib/activityActions'
import { fetchActivitiesPage, DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'
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

  // Resets back to the first page, e.g. after login or a sync/import.
  const reloadActivities = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) {
      setActivities([])
      setHasMoreActivities(false)
      return
    }

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

    const { error } = await deleteActivity(supabase, activity)
    if (error) {
      alert('Error while deleting activity: ' + error.message)
      return
    }

    setActivities((prev) => prev.filter((a) => a.id !== activity.id))
  }

  const latestActivity = activities[0] || null

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* Main Cockpit */}
      <div className="flex-1 w-full space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
            Ride Telemetry
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live tracking & neuromuscular session analysis
          </p>
        </div>

        {/* Telemetry tiles */}
        <TelemetryCards lastActivity={latestActivity} />

        {/* Activity list */}
        <ActivityFeed
          activities={activities}
          onAddWorkout={() => setIsWorkoutModalOpen(true)}
          onDeleteActivity={handleDeleteActivity}
          hasMore={hasMoreActivities}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreActivities}
        />
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