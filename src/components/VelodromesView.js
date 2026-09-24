'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamický import Leaflet mapy
const VelodromeMap = dynamic(() => import('./VelodromeMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] w-full bg-slate-200 dark:bg-surface-darkCard border border-slate-300 dark:border-surface-darkBorder rounded-2xl flex items-center justify-center text-slate-400 font-semibold text-sm">
      Loading Worldwide Track Radar...
    </div>
  )
})

export default function VelodromesView({ tracks = [], onRefreshTracks }) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [search, setSearch] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState('ALL')
  const [indoorFilter, setIndoorFilter] = useState('ALL')
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'table'
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    country_code: '',
    length_m: '250',
    surface: 'Wood',
    is_indoor: true,
    elevation_m: '100',
    latitude: '',
    longitude: '',
    notes: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const res = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      const json = await res.json()
      if (res.ok) {
        alert('🏁 Velodrome added successfully!')
        setShowAddModal(false)
        setFormData({
          name: '',
          country_code: '',
          length_m: '250',
          surface: 'Wood',
          is_indoor: true,
          elevation_m: '100',
          latitude: '',
          longitude: '',
          notes: ''
        })
        if (onRefreshTracks) onRefreshTracks()
      } else {
        alert('Error: ' + json.error)
      }
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

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
    <div className="space-y-6">
      {/* Hlavička & tlačítko pro přidání */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
            Velodromes Directory
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Global repository of banked track geometry, altitude and surfaces.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(!showAddModal)}
          className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-sm transition"
        >
          {showAddModal ? 'Close Form' : '+ Add Velodrome'}
        </button>
      </div>

      {/* KPI Ukazatele */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Tracks</div>
          <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">{totalTracks}</div>
        </div>
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Indoor Ovals</div>
          <div className="text-3xl font-black text-amber-500 dark:text-amber-400 mt-1">{indoorCount}</div>
        </div>
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Outdoor Tracks</div>
          <div className="text-3xl font-black text-sky-500 dark:text-sky-400 mt-1">{outdoorCount}</div>
        </div>
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Countries</div>
          <div className="text-3xl font-black text-emerald-500 dark:text-brand-neon mt-1">{uniqueCountries}</div>
        </div>
      </div>

      {/* Formulář pro přidání dráhy */}
      {showAddModal && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-surface-darkCard p-6 rounded-2xl border border-emerald-500/40 shadow-md space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
            🏁 Add New Track Oval
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Track Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Stab Vélodrome"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Country Code (3 letters)</label>
              <input
                type="text"
                maxLength={3}
                placeholder="CZE, USA, FRA..."
                value={formData.country_code}
                onChange={e => setFormData({...formData, country_code: e.target.value.toUpperCase()})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 uppercase"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Surface *</label>
              <select
                value={formData.surface}
                onChange={e => setFormData({...formData, surface: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="Wood">Wood</option>
                <option value="Concrete">Concrete</option>
                <option value="Asphalt">Asphalt</option>
                <option value="Tarmac">Tarmac</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Length (m) *</label>
              <input
                required
                type="number"
                step="0.1"
                placeholder="250.0"
                value={formData.length_m}
                onChange={e => setFormData({...formData, length_m: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Environment</label>
              <select
                value={formData.is_indoor ? 'true' : 'false'}
                onChange={e => setFormData({...formData, is_indoor: e.target.value === 'true'})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="true">🏟️ Indoor</option>
                <option value="false">☀️ Outdoor</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Altitude (m a.s.l.)</label>
              <input
                type="number"
                placeholder="240"
                value={formData.elevation_m}
                onChange={e => setFormData({...formData, elevation_m: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Notes</label>
              <input
                type="text"
                placeholder="Banking or features..."
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition text-xs uppercase tracking-wider"
          >
            {submitting ? 'Saving to Database...' : 'Save Velodrome'}
          </button>
        </form>
      )}

      {/* Radarová mapa */}
      <section className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            🌍 Worldwide Radar
          </h2>
          <span className="text-xs text-slate-400">
            {tracks.filter(t => t.latitude).length} mapped
          </span>
        </div>
        <VelodromeMap tracks={tracks} />
      </section>

      {/* Ovládání filtrů */}
      <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder="🔍 Search tracks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 w-44"
          />

          <select
            value={indoorFilter}
            onChange={e => setIndoorFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Types</option>
            <option value="INDOOR">🏟️ Indoor</option>
            <option value="OUTDOOR">☀️ Outdoor</option>
          </select>

          <select
            value={surfaceFilter}
            onChange={e => setSurfaceFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Surfaces</option>
            <option value="Wood">Wood</option>
            <option value="Concrete">Concrete</option>
            <option value="Asphalt">Asphalt</option>
          </select>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto">
          <span className="text-xs text-slate-400 mr-2">
            <strong>{filteredTracks.length}</strong> / {totalTracks}
          </span>
          <button
            onClick={() => setViewMode('cards')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
              viewMode === 'cards'
                ? 'bg-emerald-500 dark:bg-brand-neon text-white dark:text-slate-950'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
              viewMode === 'table'
                ? 'bg-emerald-500 dark:bg-brand-neon text-white dark:text-slate-950'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            Table
          </button>
        </div>
      </div>

      {/* Karty velodromů */}
      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTracks.map(t => (
            <div
              key={t.id}
              className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder hover:border-slate-400 dark:hover:border-slate-600 transition shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base leading-snug">
                    {t.name}
                  </h3>
                  {t.country_code && (
                    <span className="bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-brand-neon font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                      {t.country_code}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2.5 border-y border-slate-100 dark:border-slate-800/80 my-2">
                  <div>
                    <span className="text-slate-400">Length:</span>{' '}
                    <strong className="text-slate-700 dark:text-slate-200">{t.length_m} m</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Surface:</span>{' '}
                    <strong className="text-slate-700 dark:text-slate-200">{t.surface}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Type:</span>{' '}
                    <strong className={t.is_indoor ? 'text-amber-500' : 'text-sky-500'}>
                      {t.is_indoor ? 'Indoor' : 'Outdoor'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Altitude:</span>{' '}
                    <strong className="text-slate-700 dark:text-slate-200">{t.elevation_m} m</strong>
                  </div>
                </div>

                {t.notes && (
                  <p className="text-xs text-slate-400 italic line-clamp-2 mt-1">"{t.notes}"</p>
                )}
              </div>

              {t.latitude && t.longitude && (
                <div className="text-[11px] text-slate-400 font-mono pt-3 border-t border-slate-100 dark:border-slate-800/50 mt-3">
                  📍 {t.latitude.toFixed(4)}, {t.longitude.toFixed(4)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Tabulka */
        <div className="overflow-x-auto bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3">Track Name</th>
                <th className="p-3">Country</th>
                <th className="p-3">Length</th>
                <th className="p-3">Surface</th>
                <th className="p-3">Type</th>
                <th className="p-3">Elevation</th>
                <th className="p-3">GPS Coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredTracks.map(t => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="p-3 font-semibold text-slate-900 dark:text-white">{t.name}</td>
                  <td className="p-3 font-mono text-emerald-600 dark:text-brand-neon font-bold">{t.country_code || '-'}</td>
                  <td className="p-3">{t.length_m} m</td>
                  <td className="p-3">{t.surface}</td>
                  <td className="p-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                      t.is_indoor 
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' 
                        : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400'
                    }`}>
                      {t.is_indoor ? 'Indoor' : 'Outdoor'}
                    </span>
                  </td>
                  <td className="p-3">{t.elevation_m} m</td>
                  <td className="p-3 font-mono text-xs text-slate-400">
                    {t.latitude ? `${t.latitude.toFixed(3)}, ${t.longitude.toFixed(3)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}