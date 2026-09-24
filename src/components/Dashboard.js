'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import RosterPanel from './RosterPanel'
import TelemetryCards from './TelemetryCards'
import FitUploader from './FitUploader'
import ThemeToggle from './ThemeToggle'
import AuthModal from './AuthModal'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const [user, setUser] = useState(null)
  const [activities] = useState(initialActivities)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const latestActivity = activities[0] || null

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-surface-dark transition-colors duration-300">
      {/* 1. Sloupec: Levý Sidebar */}
      <Sidebar />

      {/* 2. Sloupec: Hlavní pracovní plocha */}
      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto max-w-5xl">
        {/* Horní ovládací lišta: Search, Theme Toggle, Profil */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-200 dark:border-surface-darkBorder">
          <div className="w-full md:w-96">
            <input
              type="text"
              placeholder="🔍 Search athletes, sessions, tracks..."
              className="w-full bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <AuthModal user={user} onAuthChange={setUser} />
          </div>
        </div>

        {/* Nadpis sekce */}
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

        {/* Telemetrické bloky z tvého návrhu */}
        <TelemetryCards lastActivity={latestActivity} />

        {/* Náš rychlý .FIT Uploader */}
        <FitUploader tracks={tracks} currentUser={user} />

        {/* Historie tréninků (Track Feed) */}
        <section className="bg-white dark:bg-surface-darkCard p-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Recent Velodrome Sessions
          </h2>

          {activities.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-sm">
              No sessions found. Drop a .FIT file above to analyze telemetry.
            </div>
          ) : (
            <div className="space-y-3">
              {activities.slice(0, 5).map((act) => (
                <div
                  key={act.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">
                      {act.title}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {act.tracks?.name || 'Track Oval'} • {new Date(act.activity_date).toLocaleDateString()}
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
      </main>

      {/* 3. Sloupec: Pravý Roster & Quick Stats */}
      <div className="hidden xl:block p-6 border-l border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard/40">
        <RosterPanel />
      </div>
    </div>
  )
}