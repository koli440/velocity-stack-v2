'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AuthModal from './AuthModal'
import FitUploader from './FitUploader'

export default function Dashboard({ tracks = [], initialActivities = [] }) {
  const [user, setUser] = useState(null)
  const [activities, setActivities] = useState(initialActivities)

  useEffect(() => {
    // Zjištění aktuální session při načtení
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    // Posluchač na přihlášení / odhlášení
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-track-line mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-track-orange tracking-wider">VELOCITY STACK</h1>
          <p className="text-slate-400 text-sm">The Track Cycling Platform</p>
        </div>
        
        {/* Auth lišta */}
        <AuthModal user={user} onAuthChange={setUser} />
      </header>

      {/* Uploader s předáním aktuálního uživatele */}
      <FitUploader tracks={tracks} currentUser={user} />

      {/* Grid: Seznam tratí a Feed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <section className="bg-track-card p-6 rounded-lg border border-track-line h-fit">
          <h2 className="text-xl font-bold mb-4 text-white">🏁 Velodromes</h2>
          <div className="space-y-3">
            {tracks.map(track => (
              <div key={track.id} className="p-3 bg-slate-900 rounded border border-slate-800">
                <div className="font-semibold text-slate-200">{track.name}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {track.length_m} m • {track.surface} • {track.banking_deg}° banking
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="md:col-span-2 bg-track-card p-6 rounded-lg border border-track-line">
          <h2 className="text-xl font-bold mb-4 text-white">⚡ Track Telemetry Feed</h2>
          {activities.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-700 rounded-lg text-slate-400">
              No track activities yet.
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map(act => (
                <div key={act.id} className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-slate-100 text-lg">{act.title}</h3>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {act.tracks?.name ? `📍 ${act.tracks.name}` : 'Unknown Track'} • {new Date(act.activity_date).toLocaleDateString()}
                      </div>
                    </div>
                    {act.chainring && act.cog && (
                      <span className="bg-slate-800 border border-slate-700 text-orange-400 text-xs font-mono font-bold px-2.5 py-1 rounded">
                        ⚙️ {act.chainring}×{act.cog}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center">
                    <div>
                      <div className="text-[11px] text-slate-400">Cadence</div>
                      <div className="font-bold text-orange-400 text-sm">{act.max_cadence_rpm ?? '-'} RPM</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Speed</div>
                      <div className="font-bold text-sky-400 text-sm">{act.max_speed_kmh ?? '-'} km/h</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Power</div>
                      <div className="font-bold text-purple-400 text-sm">{act.max_power_w ?? '-'} W</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Torque</div>
                      <div className="font-bold text-emerald-400 text-sm">{act.peak_torque_nm ?? '-'} Nm</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
