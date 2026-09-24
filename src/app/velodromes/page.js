'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

// Dynamický import mapy bez server-side renderingu (SSR)
const VelodromeMap = dynamic(() => import('../../components/VelodromeMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] w-full bg-slate-900 border border-track-line rounded-xl flex items-center justify-center text-slate-500">
      Loading World Velodrome Map...
    </div>
  )
})

export default function VelodromesPage() {
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState('ALL')
  const [indoorFilter, setIndoorFilter] = useState('ALL')
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'table'

  const loadTracks = async () => {
    setLoading(true)
    const { data } = await supabase.from('tracks').select('*').order('name')
    setTracks(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadTracks()
  }, [])

  // KPI metriky
  const totalTracks = tracks.length
  const indoorCount = tracks.filter(t => t.is_indoor).length
  const outdoorCount = totalTracks - indoorCount
  const uniqueCountries = new Set(tracks.map(t => t.country_code).filter(Boolean)).size

  // Filtrování
  const filteredTracks = tracks.filter(t => {
    const matchesSearch =
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.country_code?.toLowerCase().includes(search.toLowerCase()) ||
      t.notes?.toLowerCase().includes(search.toLowerCase())

    const matchesSurface =
      surfaceFilter === 'ALL' || t.surface?.toLowerCase() === surfaceFilter.toLowerCase()

    const matchesIndoor =
      indoorFilter === 'ALL' ||
      (indoorFilter === 'INDOOR' && t.is_indoor) ||
      (indoorFilter === 'OUTDOOR' && !t.is_indoor)

    return matchesSearch && matchesSurface && matchesIndoor
  })

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Hlavička */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-track-line gap-4">
        <div>
          <Link href="/" className="text-xs text-track-orange hover:underline font-bold uppercase tracking-wider mb-1 block">
            ← Back to Feed
          </Link>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-wide">
            🏁 VELODROMES DATABASE
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Global catalog of tracks with precision geometry, banking, and air-density altitude data.
          </p>
        </div>
      </header>

      {/* KPI Karty */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-track-card p-4 rounded-xl border border-track-line">
          <div className="text-xs text-slate-400 uppercase font-semibold">Total Velodromes</div>
          <div className="text-3xl font-extrabold text-white mt-1">{totalTracks}</div>
        </div>
        <div className="bg-track-card p-4 rounded-xl border border-track-line">
          <div className="text-xs text-slate-400 uppercase font-semibold">Indoor Tracks</div>
          <div className="text-3xl font-extrabold text-orange-400 mt-1">{indoorCount}</div>
        </div>
        <div className="bg-track-card p-4 rounded-xl border border-track-line">
          <div className="text-xs text-slate-400 uppercase font-semibold">Outdoor Tracks</div>
          <div className="text-3xl font-extrabold text-sky-400 mt-1">{outdoorCount}</div>
        </div>
        <div className="bg-track-card p-4 rounded-xl border border-track-line">
          <div className="text-xs text-slate-400 uppercase font-semibold">Countries</div>
          <div className="text-3xl font-extrabold text-emerald-400 mt-1">{uniqueCountries}</div>
        </div>
      </div>

      {/* Mapa všech velodromů */}
      <section className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-200">🌍 Worldwide Track Map</h2>
          <span className="text-xs text-slate-400">{tracks.filter(t => t.latitude).length} mapped locations</span>
        </div>
        <VelodromeMap tracks={tracks} />
      </section>

      {/* Ovládací panel / Filtry */}
      <section className="bg-track-card p-5 rounded-xl border border-track-line space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="🔍 Search by name, country code (e.g. CZE, USA, GBR)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-track-orange"
            />
          </div>

          <div>
            <select
              value={indoorFilter}
              onChange={e => setIndoorFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-track-orange"
            >
              <option value="ALL">All Environments</option>
              <option value="INDOOR">🏟️ Indoor only</option>
              <option value="OUTDOOR">☀️ Outdoor only</option>
            </select>
          </div>

          <div>
            <select
              value={surfaceFilter}
              onChange={e => setSurfaceFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-track-orange"
            >
              <option value="ALL">All Surfaces</option>
              <option value="Wood">Wood</option>
              <option value="Concrete">Concrete</option>
              <option value="Asphalt">Asphalt / Tarmac</option>
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-slate-800">
          <div>Showing <strong className="text-white">{filteredTracks.length}</strong> of {totalTracks} velodromes</div>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1 rounded transition ${viewMode === 'cards' ? 'bg-track-orange text-white font-bold' : 'bg-slate-800 text-slate-400'}`}
            >
              Cards View
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded transition ${viewMode === 'table' ? 'bg-track-orange text-white font-bold' : 'bg-slate-800 text-slate-400'}`}
            >
              Table View
            </button>
          </div>
        </div>
      </section>

      {/* Seznam drah: Cards nebo Table */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">Loading catalog...</div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTracks.map(t => (
            <div key={t.id} className="bg-track-card p-5 rounded-xl border border-track-line hover:border-slate-600 transition flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h3 className="font-bold text-white text-base leading-snug">{t.name}</h3>
                  {t.country_code && (
                    <span className="bg-slate-800 text-orange-400 font-mono text-xs font-bold px-2 py-0.5 rounded border border-slate-700 shrink-0">
                      {t.country_code}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2.5 border-y border-slate-800/80 my-3">
                  <div><span className="text-slate-500">Length:</span> <strong className="text-slate-200">{t.length_m} m</strong></div>
                  <div><span className="text-slate-500">Surface:</span> <strong className="text-slate-200">{t.surface}</strong></div>
                  <div><span className="text-slate-500">Type:</span> <strong className={t.is_indoor ? 'text-amber-400' : 'text-sky-400'}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</strong></div>
                  <div><span className="text-slate-500">Elevation:</span> <strong className="text-slate-200">{t.elevation_m} m</strong></div>
                </div>

                {t.notes && (
                  <p className="text-xs text-slate-400 italic line-clamp-2 mb-2">"{t.notes}"</p>
                )}
              </div>

              {t.latitude && t.longitude && (
                <div className="text-[11px] text-slate-500 font-mono pt-2 border-t border-slate-800/40">
                  📍 {t.latitude.toFixed(4)}, {t.longitude.toFixed(4)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Tabulkový režim */
        <div className="overflow-x-auto bg-track-card rounded-xl border border-track-line">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">Track Name</th>
                <th className="p-3">Country</th>
                <th className="p-3">Length</th>
                <th className="p-3">Surface</th>
                <th className="p-3">Type</th>
                <th className="p-3">Elevation</th>
                <th className="p-3">GPS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredTracks.map(t => (
                <tr key={t.id} className="hover:bg-slate-900/60">
                  <td className="p-3 font-semibold text-white">{t.name}</td>
                  <td className="p-3 font-mono text-orange-400">{t.country_code || '-'}</td>
                  <td className="p-3">{t.length_m} m</td>
                  <td className="p-3">{t.surface}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${t.is_indoor ? 'bg-amber-950/60 text-amber-400' : 'bg-sky-950/60 text-sky-400'}`}>
                      {t.is_indoor ? 'Indoor' : 'Outdoor'}
                    </span>
                  </td>
                  <td className="p-3">{t.elevation_m} m</td>
                  <td className="p-3 font-mono text-xs text-slate-500">
                    {t.latitude ? `${t.latitude.toFixed(2)}, ${t.longitude.toFixed(2)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
