'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import RosterPanel from './RosterPanel'
import TelemetryCards from './TelemetryCards'
import FitUploader from './FitUploader'
import VelodromesView from './VelodromesView'
import ThemeToggle from './ThemeToggle'
import ProfileSettingsModal from './ProfileSettingsModal'
import ActivityFeed from './ActivityFeed'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [activities, setActivities] = useState(initialActivities)
  const [currentTracks, setCurrentTracks] = useState(tracks)
  const [currentView, setCurrentView] = useState('home')
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  const fetchUserProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      setProfile(data)
      if (data.theme_preference) {
        setTheme(data.theme_preference)
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login')
      } else {
        const currentUser = session.user
        setUser(currentUser)
        fetchUserProfile(currentUser.id)
        reloadActivities(currentUser.id) // <--- Načíst aktivity konkrétního jezdce
        setCheckingAuth(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.push('/login')
      } else {
        const currentUser = session.user
        setUser(currentUser)
        fetchUserProfile(currentUser.id)
        reloadActivities(currentUser.id) // <--- Obnovit při přepnutí účtu
      }
    })

    return () => subscription.unsubscribe()
  }, [router, setTheme])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const reloadTracks = async () => {
    const { data } = await supabase.from('tracks').select('*').order('name')
    if (data) setCurrentTracks(data)
  }

  // Načítání aktivit pouze pro aktuálně přihlášeného jezdce
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

  // Zobrazit loader při ověřování přihlášení
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-surface-dark text-slate-500 font-bold text-xs uppercase tracking-widest">
        Verifying athlete credentials...
      </div>
    )
  }

  const latestActivity = activities[0] || null

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-surface-dark transition-colors duration-300">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
      />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto max-w-5xl">
        {/* Horní lišta s profilem a odhlášením */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-200 dark:border-surface-darkBorder">
          <div className="w-full md:w-96">
            <input
              type="text"
              placeholder="🔍 Search athletes, sessions, tracks..."
              className="w-full bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition shadow-sm"
            >
              <span>👤</span>
              <span>{profile?.nickname || profile?.first_name || user?.email?.split('@')[0]}</span>
            </button>

            <ThemeToggle currentUser={user} />

            <button
              onClick={handleSignOut}
              className="py-1.5 px-3 rounded-xl bg-slate-200/80 hover:bg-rose-500 hover:text-white dark:bg-slate-800 dark:hover:bg-rose-600 text-slate-700 dark:text-slate-300 text-xs font-bold transition shadow-sm"
              title="Sign Out"
            >
              Log Out
            </button>
          </div>
        </div>

        {currentView === 'home' ? (
          <>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
                Ride Telemetry
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live tracking & neuromuscular session analysis
              </p>
            </div>

            <TelemetryCards lastActivity={latestActivity} />
            <ActivityFeed activities={activities} onAddWorkout={() => setIsWorkoutModalOpen(true)} />

          </>
        ) : (
          <VelodromesView tracks={currentTracks} onRefreshTracks={reloadTracks} />
        )}
      </main>

      <div className="hidden xl:block p-6 border-l border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard/40">
        <RosterPanel onAddWorkout={() => setIsWorkoutModalOpen(true)} />
      </div>

      {isWorkoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <FitUploader
              tracks={currentTracks}
              currentUser={user}
              onClose={() => setIsWorkoutModalOpen(false)}
              onSaved={(newActivityId) => {
          setIsWorkoutModalOpen(false)
          if (newActivityId) {
            router.push(`/activities/${newActivityId}`)
          } else {
            reloadActivities(user.id)
          }
        }}
            />
          </div>
        </div>
      )}

      <ProfileSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => {
          setIsSettingsModalOpen(false)
          if (user?.id) fetchUserProfile(user.id)
        }}
        user={user}
        tracks={currentTracks}
      />
    </div>
  )
}