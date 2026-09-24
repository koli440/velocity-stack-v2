import { supabase } from '../lib/supabase'
import FitUploader from '../components/FitUploader'

export const revalidate = 0

export default async function Home() {
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="flex justify-between items-center pb-8 border-b border-track-line mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-track-orange tracking-wider">VELOCITY STACK</h1>
          <p className="text-slate-400 text-sm">The Track Cycling Platform</p>
        </div>
      </header>

      {/* Interaktivní FIT Uploader a výpočet křivek */}
      <FitUploader />

      {/* Tratě ze Supabase */}
      <section className="bg-track-card p-6 rounded-lg border border-track-line">
        <h2 className="text-xl font-bold mb-4 text-white">🏁 Velodromes Directory</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
    </main>
  )
}
