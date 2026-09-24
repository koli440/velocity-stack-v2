import { supabase } from '../lib/supabase'
import FitUploader from '../components/FitUploader'

export const revalidate = 0

export default async function Home() {
  // 1. Načtení velodromů
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')

  // 2. Načtení uložených aktivit včetně detailu velodromu
  const { data: activities } = await supabase
    .from('activities')
    .select(`
      *,
      tracks ( name, length_m, surface )
    `)
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="flex justify-between items-center pb-8 border-b border-track-line mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-track-orange tracking-wider">VELOCITY STACK</h1>
          <p className="text-slate-400 text-sm">The Track Cycling Platform</p>
        </div>
      </header>

      {/* Interaktivní Uploader a Analýza */}
      <FitUploader tracks={tracks || []} />

      {/* Grid: Velodromy vlevo + Feed vpravo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Velodromy */}
        <section className="bg-track-card p-6 rounded-lg border border-track-line h-fit">
          <h2 className="text-xl font-bold mb-4 text-white">🏁 Velodromes</h2>
          <div className="space-y-3">
            {tracks?.map(track => (
              <div key={track.id} className="p-3 bg-slate-900 rounded border border-slate-800">
                <div className="font-semibold text-slate-200">{track.name}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {track.length_m} m • {track.surface} • {track.banking_deg}° banking
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Track Telemetry Feed */}
        <section className="md:col-span-2 bg-track-card p-6 rounded-lg border border-track-line">
          <h2 className="text-xl font-bold mb-4 text-white">⚡ Track Telemetry Feed</h2>
          
          {(!activities || activities.length === 0) ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-700 rounded-lg text-slate-400">
              <p className="text-lg">No track activities yet.</p>
              <p className="text-sm mt-1">Upload and save your first session above to populate the feed.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map(act => (
                <div key={act.id} className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-slate-100 text-lg">{act.title}</h3>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {act.tracks?.name ? `📍 ${act.tracks.name}` : 'Unknown Velodrome'} • {new Date(act.activity_date).toLocaleDateString()}
                      </div>
                    </div>
                    {act.chainring && act.cog && (
                      <span className="bg-slate-800 border border-slate-700 text-orange-400 text-xs font-mono font-bold px-2.5 py-1 rounded">
                        ⚙️ {act.chainring}×{act.cog}
                      </span>
                    )}
                  </div>

                  {/* Metriky jízdy */}
                  <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center">
                    <div>
                      <div className="text-[11px] text-slate-400">Peak Cadence</div>
                      <div className="font-bold text-orange-400 text-sm">{act.max_cadence_rpm ?? '-'} RPM</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Max Speed</div>
                      <div className="font-bold text-sky-400 text-sm">{act.max_speed_kmh ?? '-'} km/h</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Max Power</div>
                      <div className="font-bold text-purple-400 text-sm">{act.max_power_w ?? '-'} W</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Peak Torque</div>
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
