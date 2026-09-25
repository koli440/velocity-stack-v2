'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import RosterPanel from './RosterPanel'
import TelemetryCards from './TelemetryCards'
import FitUploader from './FitUploader'
import ActivityFeed from './ActivityFeed'
import IntervalsSyncModal from './IntervalsSyncModal'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [activities, setActivities] = useState(initialActivities)
  const [currentTracks, setCurrentTracks] = useState(tracks)
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false)
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)

  const reloadActivities = async (userId) => {
    const targetId = userId || user?.id
    if (!targetId) {
      setActivities([])
      return
    }

    const { data, error } = await supabase
      .from('activities')
      .select('*, tracks(*)')
      .eq('user_id', targetId)
      .order('activity_date', { ascending: false })

    if (!error && data) {
      setActivities(data)
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

  const latestActivity = activities[0] || null

  return (
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* 1. Hlavní plocha Cockpitu */}
      <div className="flex-1 w-full space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
            Ride Telemetry
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live tracking & neuromuscular session analysis
          </p>
        </div>

        {/* KPI dlaždice a telemetrie */}
        <TelemetryCards lastActivity={latestActivity} />

        {/* Seznam jízd přihlášeného jezdce */}
        <ActivityFeed
          activities={activities}
          onAddWorkout={() => setIsWorkoutModalOpen(true)}
        />
      </div>

      {/* 2. Pravý panel s tlačítkem syncu a Rosterem */}
      <div className="w-full xl:w-80 shrink-0 space-y-3">
        <button
          onClick={() => setIsSyncModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-bold transition border border-purple-500/30 shadow-xs"
        >
          <span>🔄</span> Sync Intervals.icu
        </button>

        <RosterPanel onAddWorkout={() => setIsWorkoutModalOpen(true)} />
      </div>

      {/* 3. Modál pro manuální nahrání .FIT souboru */}
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

      {/* 4. Modál pro synchronizaci z Intervals.icu */}
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
    </div>
  )
}