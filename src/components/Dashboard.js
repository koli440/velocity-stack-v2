'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import AuthModal from './AuthModal'
import FitUploader from './FitUploader'

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

  return (
    <main className="min-h-screen p-6 md:p-12 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-nordic-border gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-nordic-orange shadow-nordic-glow animate-pulse"></span>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              VELOCITY<span className="text-nordic-orange">STACK</span>
            </h1>
          </div>
          <p className="text-nordic-muted text-xs md:text-sm mt-0.5">
            Precision telemetry & neuromuscular profiling for track cycling.
          </p>
        </div>
        
        <AuthModal user={user} onAuthChange={setUser} />
      </header>

      {/* Uploader */}
      <FitUploader tracks={tracks} currentUser={user} />

      {/* Hlavní obsahová mřížka */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Katalog drah vlevo */}
        <section className="bg-nordic-card backdrop-blur-md p-6 rounded-2xl border border-nordic-border shadow-nordic-card h-fit">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🏁</span> Velodromes
            </h2>
            <Link 
              href="/velodromes" 
              className="text-xs font-semibold text-nordic-orange hover:text-orange-400 transition"
            >
              All 123 tracks →
            </Link>
          </div>
          
          <div className="space-y-3">
            {tracks.slice(0, 5).map(track => (
              <div 
                key={track.id} 
                className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 hover:border-slate-700 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="font-medium text-sm text-slate-200">{track.name}</div>
                  {track.country_code && (
                    <span className="text-[10px] font-bold text-slate-400 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                      {track.country_code}
                    </span>
                  )}
                </div>
                <div className="text-xs text-nordic-muted mt-1.5 flex gap-2">
                  <span>{track.length_m} m</span>
                  <span>•</span>
                  <span>{track.surface}</span>
                  <span>•</span>
                  <span className={track.is_indoor ? 'text-amber-400/90' : 'text-sky-400/90'}>
                    {track.is_indoor ? 'Indoor' : 'Outdoor'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Feed aktivit vpravo */}
        <section className="md:col-span-2 bg-nordic-card backdrop-blur-md p-6 rounded-2xl border border-nordic-border shadow-nordic-card space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
            <span>⚡</span> Track Telemetry Feed
          </h2>

          {activities.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed border-nordic-border rounded-2xl text-nordic-muted">
              <p className="text-base font-medium">No sessions analyzed yet.</p>
              <p className="text-xs mt-1">Drop your first raw .FIT file into the analyzer above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map(act => (
                <div 
                  key={act.id} 
                  className="p-5 bg-slate-900/60 rounded-xl border border-slate-800/80 hover:border-slate-700/80 transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-white text-base tracking-tight">{act.title}</h3>
                      <div className="text-xs text-nordic-muted mt-0.5 flex items-center gap-2">
                        <span>{act.tracks?.name ? `📍 ${act.tracks.name}` : 'Track Oval'}</span>
                        <span>•</span>
                        <span>{new Date(act.activity_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {act.chainring && act.cog && (
                      <span className="bg-slate-800/90 border border-slate-700 text-nordic-orange text-xs font-mono font-bold px-2.5 py-1 rounded-lg">
                        ⚙️ {act.chainring}×{act.cog}
                      </span>
                    )}
                  </div>

                  {/* 4 hlavní metriky */}
                  <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-slate-800/60 text-center">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-nordic-muted">Cadence</div>
                      <div className="font-extrabold text-nordic-orange text-base mt-0.5">
                        {act.max_cadence_rpm ? `${act.max_cadence_rpm} RPM` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-nordic-muted">Speed</div>
                      <div className="font-extrabold text-nordic-cyan text-base mt-0.5">
                        {act.max_speed_kmh ? `${act.max_speed_kmh} km/h` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-nordic-muted">Power</div>
                      <div className="font-extrabold text-nordic-purple text-base mt-0.5">
                        {act.max_power_w ? `${act.max_power_w} W` : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-nordic-muted">Torque</div>
                      <div className="font-extrabold text-nordic-emerald text-base mt-0.5">
                        {act.peak_torque_nm ? `${act.peak_torque_nm} Nm` : '-'}
                      </div>
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
