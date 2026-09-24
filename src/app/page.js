import { supabase } from '@/lib/supabase'

export const revalidate = 0 // Vždy čerstvá data

export default async function Home() {
  // Načtení tratí ze Supabase
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center pb-8 border-b border-track-line">
        <div>
          <h1 className="text-3xl font-extrabold text-track-orange tracking-wider">VELOCITY STACK</h1>
          <p className="text-slate-400 text-sm">The Track Cycling Platform</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-track-orange hover:bg-orange-600 text-white font-bold py-2 px-4 rounded transition">
            + Upload .FIT File
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
        
        {/* Levý panel: Velodromy */}
        <section className="bg-track-card p-6 rounded-lg border border-track-line">
          <h2 className="text-xl font-bold mb-4 text-white">🏁 Velodromes</h2>
          <div className="space-y-4">
            {tracks?.map(track => (
              <div key={track.id} className="p-3 bg-slate-900 rounded border border-slate-800">
                <div className="font-semibold text-slate-200">{track.name}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {track.length_m} m • {track.surface} • {track.banking_deg}° banking
                </div>
                <div className="text-xs text-orange-400 mt-0.5">
                  Elevation: {track.elevation_m} m
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Prostřední a pravý panel: Track Activity Feed */}
        <section className="md:col-span-2 bg-track-card p-6 rounded-lg border border-track-line">
          <h2 className="text-xl font-bold mb-4 text-white">⚡ Track Telemetry Feed</h2>
          
          <div className="p-6 text-center border-2 border-dashed border-slate-700 rounded-lg text-slate-400">
            <p className="text-lg">No track activities yet.</p>
            <p className="text-sm mt-1">Upload a workout .FIT file or record a session to unlock cadence, speed, and torque curves.</p>
          </div>
        </section>

      </div>
    </main>
  )
}
