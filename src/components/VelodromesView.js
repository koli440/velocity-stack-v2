'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Icon from './Icon'
import SegmentedTabs from './SegmentedTabs'
import SuggestionNotice from './SuggestionNotice'
import { supabase, getAuthHeader } from '../lib/supabase'
import { fetchSurfaces, mergeSurfaces } from '../lib/lookups'
import { buildVelodromePayload, surfaceEnvironmentHint } from '../lib/velodromeSuggestions'

// Dynamic import of the Leaflet map
const VelodromeMap = dynamic(() => import('./VelodromeMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] sm:h-[380px] w-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center justify-center text-slate-700 dark:text-slate-200 font-semibold text-sm">
      Loading Worldwide Track Radar...
    </div>
  )
})

const controlCls = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40'

const Fact = ({ label, children }) => (
  <div>
    <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</dt>
    <dd className="font-semibold text-slate-900 dark:text-white">{children}</dd>
  </div>
)

const num = (v, fallback) => (v == null || v === '' || isNaN(Number(v)) ? fallback : Number(v))
const SORTERS = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  country: (a, b) => (a.country_code || '~').localeCompare(b.country_code || '~') || (a.name || '').localeCompare(b.name || ''),
  length: (a, b) => num(a.length_m, Infinity) - num(b.length_m, Infinity) || (a.name || '').localeCompare(b.name || ''),
  elevation: (a, b) => num(b.elevation_m, -Infinity) - num(a.elevation_m, -Infinity) || (a.name || '').localeCompare(b.name || ''),
}

export default function VelodromesView({ tracks = [] }) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [search, setSearch] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState('ALL')
  const [indoorFilter, setIndoorFilter] = useState('ALL')
  const [countryFilter, setCountryFilter] = useState('ALL')
  const [showCountries, setShowCountries] = useState(false)
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'table'
  const [submitting, setSubmitting] = useState(false)
  // The directory is public; suggesting new tracks or edits needs an account.
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data?.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  const [lookupSurfaces, setLookupSurfaces] = useState([])
  useEffect(() => {
    fetchSurfaces(supabase).then(setLookupSurfaces).catch(() => {})
  }, [])

  const surfaceOptions = mergeSurfaces(lookupSurfaces, tracks)

  const emptyForm = {
    name: '',
    country_code: '',
    length_m: '250',
    surface: 'Wood',
    is_indoor: true,
    elevation_m: '',
    latitude: '',
    longitude: '',
    notes: '',
    website_url: '',
    pricing_url: '',
    booking_url: ''
  }
  const [formData, setFormData] = useState(emptyForm)
  const [editingTrack, setEditingTrack] = useState(null)

  const openAdd = () => {
    if (showAddModal && !editingTrack) return setShowAddModal(false)
    setEditingTrack(null)
    setFormData(emptyForm)
    setShowAddModal(true)
  }

  const openEdit = (t) => {
    setEditingTrack(t)
    setFormData(Object.fromEntries(
      Object.keys(emptyForm).map(k => [k, t[k] == null ? (k === 'is_indoor' ? false : '') : t[k]])
    ))
    setShowAddModal(true)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const { payload, error } = buildVelodromePayload(formData, editingTrack)
    if (error) {
      alert(error)
      return
    }
    setSubmitting(true)

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          entity_type: 'velodrome',
          target_id: editingTrack ? editingTrack.id : null,
          payload
        })
      })

      const json = await res.json()
      if (res.ok) {
        alert('Thanks! Your suggestion was submitted for admin review. It will not appear immediately.')
        setShowAddModal(false)
        setEditingTrack(null)
        setFormData(emptyForm)
      } else {
        alert(res.status === 401 ? 'Please log in to submit suggestions.' : 'Error: ' + json.error)
      }
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // KPI metrics
  const totalTracks = tracks.length
  const indoorCount = tracks.filter(t => t.is_indoor).length
  const outdoorCount = totalTracks - indoorCount
  const uniqueCountries = new Set(tracks.map(t => t.country_code).filter(Boolean)).size

  const countryList = [...new Set(tracks.map(t => t.country_code).filter(Boolean))].sort()

  const clearTileFilters = () => {
    setIndoorFilter('ALL')
    setCountryFilter('ALL')
    setShowCountries(false)
  }
  const toggleIndoorTile = (value) => {
    setCountryFilter('ALL')
    setShowCountries(false)
    setIndoorFilter(indoorFilter === value ? 'ALL' : value)
  }
  const toggleCountriesTile = () => {
    if (showCountries) {
      setShowCountries(false)
      setCountryFilter('ALL')
    } else {
      setShowCountries(true)
    }
  }
  const activeTile = showCountries
    ? 'COUNTRIES'
    : indoorFilter === 'INDOOR' ? 'INDOOR' : indoorFilter === 'OUTDOOR' ? 'OUTDOOR' : 'TOTAL'
  const tileClass = (id) =>
    `glass-dense text-left bg-white dark:bg-surface-darkCard p-4 min-h-[44px] rounded-2xl border shadow-sm transition cursor-pointer hover:border-emerald-500 ${
      activeTile === id
        ? 'border-emerald-500 ring-2 ring-emerald-500/40'
        : 'border-slate-200 dark:border-surface-darkBorder'
    }`

  // Filtering
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

    const matchesCountry = countryFilter === 'ALL' || t.country_code === countryFilter

    return matchesSearch && matchesSurface && matchesIndoor && matchesCountry
  })

  const sortedTracks = [...filteredTracks].sort(SORTERS[sortBy] || SORTERS.name)
  const resetFilters = () => {
    setSearch('')
    setSurfaceFilter('ALL')
    clearTileFilters()
  }

  return (
    <div className="space-y-6">
      {/* Header & add button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            Velodromes directory
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            Banked tracks worldwide with length, surface, altitude and location.
          </p>
        </div>

        {signedIn && <button
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-sm shadow-sm transition"
        >
          <Icon name={showAddModal && !editingTrack ? 'close' : 'plus'} size={16} />
          {showAddModal && !editingTrack ? 'Close form' : 'Suggest velodrome'}
        </button>}
      </div>

      {/* KPI Indicators (clickable filters) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          ['TOTAL', 'Total tracks', totalTracks, 'text-slate-900 dark:text-white', clearTileFilters],
          ['INDOOR', 'Indoor ovals', indoorCount, 'text-amber-700 dark:text-amber-300', () => toggleIndoorTile('INDOOR')],
          ['OUTDOOR', 'Outdoor tracks', outdoorCount, 'text-sky-700 dark:text-sky-300', () => toggleIndoorTile('OUTDOOR')],
          ['COUNTRIES', 'Countries', uniqueCountries, 'text-emerald-700 dark:text-brand-neon', toggleCountriesTile],
        ].map(([id, label, value, color, onClick]) => (
          <button key={id} type="button" aria-pressed={activeTile === id} onClick={onClick} className={tileClass(id)}>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</div>
            <div className={`text-3xl font-black mt-1 ${color}`}>{value}</div>
          </button>
        ))}
      </div>

      {showCountries && (
        <div className="flex flex-wrap gap-2">
          {countryList.map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={countryFilter === c}
              onClick={() => setCountryFilter(countryFilter === c ? 'ALL' : c)}
              className={`px-3 py-2 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-lg text-sm font-mono font-bold border transition ${
                countryFilter === c
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Form for adding a track */}
      {signedIn && showAddModal && (
        <form onSubmit={handleSubmit} className="glass-dense bg-white dark:bg-surface-darkCard p-4 sm:p-6 rounded-2xl border border-emerald-500/40 shadow-md space-y-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            <Icon name="flag" /> {editingTrack ? `Suggest edit: ${editingTrack.name}` : 'Suggest New Track Oval'}
          </h3>
          <SuggestionNotice />
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Track Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Stab Velodrome"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Country Code (3 letters)</label>
              <input
                type="text"
                maxLength={3}
                placeholder="CZE, USA, FRA..."
                value={formData.country_code}
                onChange={e => setFormData({...formData, country_code: e.target.value.toUpperCase()})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40 uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Surface *</label>
              <select
                value={formData.surface}
                onChange={e => setFormData({...formData, surface: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                {surfaceOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Length (m) *</label>
              <input
                required
                type="number"
                step="0.1"
                placeholder="250.0"
                value={formData.length_m}
                onChange={e => setFormData({...formData, length_m: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Environment</label>
              <select
                value={formData.is_indoor ? 'true' : 'false'}
                onChange={e => setFormData({...formData, is_indoor: e.target.value === 'true'})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <option value="true">Indoor</option>
                <option value="false">Outdoor</option>
              </select>
              {surfaceEnvironmentHint(formData.surface, formData.is_indoor) && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{surfaceEnvironmentHint(formData.surface, formData.is_indoor)}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Altitude (m a.s.l.)</label>
              <input
                type="number"
                placeholder="240"
                value={formData.elevation_m}
                onChange={e => setFormData({...formData, elevation_m: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes</label>
              <input
                type="text"
                placeholder="Banking or features..."
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Website</label>
              <input
                type="url"
                placeholder="https://..."
                value={formData.website_url}
                onChange={e => setFormData({...formData, website_url: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Pricing / price list</label>
              <input
                type="url"
                placeholder="https://..."
                value={formData.pricing_url}
                onChange={e => setFormData({...formData, pricing_url: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Booking form</label>
              <input
                type="url"
                placeholder="https://..."
                value={formData.booking_url}
                onChange={e => setFormData({...formData, booking_url: e.target.value})}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 min-h-[44px] rounded-xl transition text-sm"
          >
            {submitting ? 'Submitting...' : 'Submit for review'}
          </button>
        </form>
      )}

      {/* Radar map (shorter on mobile so the list stays in reach) */}
      <section className="space-y-2">
        <div className="flex justify-between items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            <Icon name="globe" /> Worldwide radar
          </h2>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {sortedTracks.filter(t => t.latitude).length} mapped
          </span>
        </div>
        <VelodromeMap tracks={sortedTracks} />
      </section>

      {/* Filter controls */}
      <div className="glass-dense bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="velodrome-search" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Search</label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                id="velodrome-search"
                type="search"
                placeholder="Name, country code or notes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${controlCls} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="velodrome-type" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Type</label>
            <select id="velodrome-type" value={indoorFilter} onChange={e => setIndoorFilter(e.target.value)} className={controlCls}>
              <option value="ALL">All types</option>
              <option value="INDOOR">Indoor</option>
              <option value="OUTDOOR">Outdoor</option>
            </select>
          </div>
          <div>
            <label htmlFor="velodrome-surface" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Surface</label>
            <select id="velodrome-surface" value={surfaceFilter} onChange={e => setSurfaceFilter(e.target.value)} className={controlCls}>
              <option value="ALL">All surfaces</option>
              {surfaceOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="velodrome-sort" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Sort by</label>
            <select id="velodrome-sort" value={sortBy} onChange={e => setSortBy(e.target.value)} className={controlCls}>
              <option value="name">Name (A-Z)</option>
              <option value="country">Country</option>
              <option value="length">Length (shortest first)</option>
              <option value="elevation">Altitude (highest first)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
            Showing <strong>{sortedTracks.length}</strong> of {totalTracks} velodromes
          </p>
          <SegmentedTabs
            label="Layout"
            value={viewMode}
            onChange={setViewMode}
            tabs={[['cards', 'Cards'], ['table', 'Table']]}
          />
        </div>
      </div>

      {sortedTracks.length === 0 ? (
        <div className="glass-dense bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder p-8 text-center">
          <p className="text-base font-bold text-slate-900 dark:text-white">No velodromes match these filters</p>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Try a different search or reset the filters.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-sm font-bold"
          >
            Reset filters
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedTracks.map(t => (
            <div
              key={t.id}
              className="glass-dense bg-white dark:bg-surface-darkCard p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder hover:border-slate-400 dark:hover:border-slate-500 transition shadow-sm flex flex-col gap-3"
            >
              <div className="flex justify-between items-start gap-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-lg leading-snug">
                  {t.slug ? <Link href={`/velodromes/${t.slug}`} className="inline-flex items-center min-h-[44px] -my-2.5 hover:underline">{t.name}</Link> : t.name}
                </h3>
                {t.country_code && (
                  <span className="bg-slate-100 dark:bg-slate-800 text-emerald-800 dark:text-brand-neon font-mono text-xs font-bold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 shrink-0">
                    {t.country_code}
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm py-3 border-y border-slate-200 dark:border-slate-700">
                <Fact label="Length">{t.length_m != null ? `${t.length_m} m` : '-'}</Fact>
                <Fact label="Surface">{t.surface || '-'}</Fact>
                <Fact label="Type">
                  <span className={t.is_indoor ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-sky-300'}>
                    {t.is_indoor ? 'Indoor' : 'Outdoor'}
                  </span>
                </Fact>
                <Fact label="Altitude">{t.elevation_m != null ? `${t.elevation_m} m` : '-'}</Fact>
              </dl>

              {t.notes && (
                <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{t.notes}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 text-sm mt-auto">
                {[['website_url', 'Website'], ['pricing_url', 'Pricing'], ['booking_url', 'Book']].map(([k, label]) =>
                  t[k] ? (
                    <a key={k} href={t[k]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] sm:min-h-0 sm:py-1 px-3 rounded-lg border border-emerald-600/40 text-emerald-800 dark:text-brand-neon font-semibold hover:bg-emerald-500/10">
                      {label}
                    </a>
                  ) : null
                )}
                {signedIn && (
                  <button type="button" onClick={() => openEdit(t)} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 sm:py-1 px-2 ml-auto text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline">
                    <Icon name="edit" size={14} /> Suggest edit
                  </button>
                )}
              </div>

              {t.latitude && t.longitude && (
                <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                  <Icon name="pin" size={12} /> {Number(t.latitude).toFixed(4)}, {Number(t.longitude).toFixed(4)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Table */
        <div className="glass-dense overflow-x-auto bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
          <table className="w-full text-left text-sm text-slate-800 dark:text-slate-200">
            <thead className="bg-slate-100 dark:bg-slate-900 text-xs uppercase font-bold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="p-3">Track name</th>
                <th scope="col" className="p-3">Country</th>
                <th scope="col" className="p-3">Length</th>
                <th scope="col" className="p-3">Surface</th>
                <th scope="col" className="p-3">Type</th>
                <th scope="col" className="p-3">Elevation</th>
                <th scope="col" className="p-3">GPS coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sortedTracks.map(t => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="p-3 font-semibold text-slate-900 dark:text-white">{t.slug ? <Link href={`/velodromes/${t.slug}`} className="inline-block py-2 hover:underline">{t.name}</Link> : t.name}</td>
                  <td className="p-3 font-mono text-emerald-800 dark:text-brand-neon font-bold">{t.country_code || '-'}</td>
                  <td className="p-3 whitespace-nowrap">{t.length_m != null ? `${t.length_m} m` : '-'}</td>
                  <td className="p-3">{t.surface || '-'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      t.is_indoor
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                    }`}>
                      {t.is_indoor ? 'Indoor' : 'Outdoor'}
                    </span>
                  </td>
                  <td className="p-3 whitespace-nowrap">{t.elevation_m != null ? `${t.elevation_m} m` : '-'}</td>
                  <td className="p-3 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {t.latitude ? `${Number(t.latitude).toFixed(3)}, ${Number(t.longitude).toFixed(3)}` : '-'}
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
