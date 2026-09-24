'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import RosterPanel from './RosterPanel'
import TelemetryCards from './TelemetryCards'
import FitUploader from './FitUploader'
import VelodromesView from './VelodromesView'
import ThemeToggle from './ThemeToggle'
import AuthModal from './AuthModal'
import ProfileSettingsModal from './ProfileSettingsModal'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const { setTheme } = useTheme()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [activities, setActivities] = useState(initialActivities)
  const [currentTracks, setCurrentTracks] = useState(tracks)
  
  // Zobrazení a modální okna
  const [currentView, setCurrentView] = useState('home')
  const [isWorkoutModalOpen, setIsWorkoutModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  // Načtení profilu uživatele z DB včetně tématu
  const fetchUserProfile = async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }
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
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) fetchUserProfile(currentUser.id)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) fetchUserProfile(currentUser.id)
    })

    return () => subscription.unsubscribe()
  }, [setTheme])

  const reloadTracks = async () => {
    const { data } = await supabase.from('tracks').select('*').order('name')
    if (data) setCurrentTracks(data)
  }

  const reloadActivities = async () => {
    const { data } = await supabase
      .from('activities')
      .select('*, tracks(*)')
      .order('activity_date', { ascending: false })
    if (data) setActivities(data)
  }

  const latestActivity = activities[0] || null

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-surface-dark transition-colors duration-300">
      {/* 1. Levý Sidebar s navigací a tlačítkem Settings */}
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        onOpenSettings={() => {
          if (!user) {
            alert('Pro přístup k nastavení profilu se nejprve přihlaste.')
            return
          }
          setIsSettingsModalOpen(true)
        }}
      />

      {/* 2. Hlavní plocha Cockpitu */}
      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto max-w-5xl">
        {/* Horní lišta */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-200 dark:border-surface-darkBorder">
          <div className="w-full md:w-96">
            <input
              type="text"
              placeholder="🔍 Search athletes, sessions, tracks..."
              className="w-full bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Tlačítko na profil, pokud je přihlášen */}
            {user && (
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 transition shadow-sm"
              >
                <span>👤</span>
                <span>{profile?.nickname || profile?.first_name || 'Profile'}</span>
              </button>
            )}

            <ThemeToggle currentUser={user} />
            <AuthModal user={user} onAuthChange={setUser} />
          </div>
        </div>

        {/* Dynamické přepínání: Home vs. Velodromes */}
        {currentView === 'home' ? (
          <>
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
                  Ride Telemetry
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live tracking & neuromuscular session analysis
                </p>
              </div>
            </div>

            {/* Metriky a Lap Telemetry */}
            <TelemetryCards lastActivity={latestActivity} />

            {/* Seznam posledních jízd */}
            <section className="bg-white dark:bg-surface-darkCard p-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Recent Velodrome Sessions
                </h2>
                <button
                  onClick={() => setIsWorkoutModalOpen(true)}
                  className="text-xs font-bold text-emerald-600 dark:text-brand-neon hover:underline"
                >
                  + Upload .FIT
                </button>
              </div>

              {activities.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-sm">
                  No sessions found. Click "+ Add Workout" to upload your first .FIT session.
                </div>
              ) : (
                <div className="space-y-3">
                  {activities.slice(0, 8).map((act) => (
                    <div
                      key={act.id}
                      className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white text-sm">
                          {act.title}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {act.tracks?.name || 'Track Oval'} •{' '}
                          {new Date(act.activity_date).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono font-bold">
                        {act.max_power_w && (
                          <span className="text-emerald-500 dark:text-brand-neon">
                            {act.max_power_w} W
                          </span>
                        )}
                        {act.max_cadence_rpm && (
                          <span className="text-orange-500">
                            {act.max_cadence_rpm} RPM
                          </span>
                        )}
                        {act.chainring && act.cog && (
                          <span className="bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded text-slate-700 dark:text-slate-300">
                            {act.chainring}×{act.cog}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <VelodromesView tracks={currentTracks} onRefreshTracks={reloadTracks} />
        )}
      </main>

      {/* 3. Pravý panel s Rosterem a tlačítkem Workoutu */}
      <div className="hidden xl:block p-6 border-l border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard/40">
        <RosterPanel onAddWorkout={() => setIsWorkoutModalOpen(true)} />
      </div>

      {/* Modální okno pro nahrání .FIT souboru */}
      {isWorkoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <FitUploader
              tracks={currentTracks}
              currentUser={user}
              onClose={() => setIsWorkoutModalOpen(false)}
              onSaved={() => {
                setIsWorkoutModalOpen(false)
                reloadActivities()
              }}
            />
          </div>
        </div>
      )}

      {/* Modální okno pro nastavení profilu jezdce */}
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