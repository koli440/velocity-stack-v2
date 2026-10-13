'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchPrivacyZone, savePrivacyZone } from '../lib/social'
import { backfillRoutePreviews } from '../lib/feedSync'
import { DEFAULT_ZONE_RADIUS_M, MIN_ZONE_RADIUS_M, MAX_ZONE_RADIUS_M, validateZone } from '../lib/privacyZone'

// GPS privacy zone settings (issue #49). Other riders never get raw GPS (restricted view);
// route previews exclude every point inside the zone. Changing the zone rebuilds previews.
export default function PrivacyZonePanel({ userId, onChanged }) {
  const [enabled, setEnabled] = useState(false)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState(String(DEFAULT_ZONE_RADIUS_M))
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    fetchPrivacyZone(supabase, userId).then(({ zone }) => {
      if (!zone) return
      setEnabled(true)
      setLat(String(zone.lat))
      setLng(String(zone.lng))
      setRadius(String(zone.radius))
    })
  }, [userId])

  const useMyLocation = () => {
    if (!navigator.geolocation) return setStatus({ error: 'Location is not available in this browser' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(5))
        setLng(pos.coords.longitude.toFixed(5))
      },
      () => setStatus({ error: 'Could not read your location' })
    )
  }

  const apply = async (zone) => {
    setBusy(true)
    setStatus(null)
    const { error, zone: saved } = await savePrivacyZone(supabase, { userId, zone })
    if (error) {
      setStatus({ error: error.message })
      setBusy(false)
      return
    }
    const rebuilt = await backfillRoutePreviews(supabase, userId, { privacyZone: saved, maxBatches: 500 })
    setStatus({ ok: saved ? `Zone saved · ${rebuilt} previews updated` : `Zone disabled · ${rebuilt} previews updated` })
    setBusy(false)
    onChanged?.()
  }

  const save = () => {
    const zone = { lat, lng, radius }
    const problem = validateZone(zone)
    if (problem) return setStatus({ error: problem })
    return apply(zone)
  }

  if (!userId) return null

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder space-y-3">
      <h3 className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">Privacy zone</h3>
      <p className="text-[11px] text-slate-500">
        Other riders never receive raw GPS, and the route shown in shared feeds hides everything inside this circle
        (e.g. your home). Your own detail page still shows the full route.
      </p>
      <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            setEnabled(e.target.checked)
            if (!e.target.checked) apply(null)
          }}
        />
        Hide a zone around a location
      </label>
      {enabled && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" aria-label="Zone latitude" inputMode="decimal" className="px-2 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" aria-label="Zone longitude" inputMode="decimal" className="px-2 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          </div>
          <label className="block text-[11px] text-slate-500">
            Radius (m, {MIN_ZONE_RADIUS_M}–{MAX_ZONE_RADIUS_M})
            <input value={radius} onChange={(e) => setRadius(e.target.value)} aria-label="Zone radius in metres" inputMode="numeric" className="mt-1 w-full px-2 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={useMyLocation} className="px-2 py-1 rounded-lg text-[11px] font-bold border border-slate-300 dark:border-slate-700 text-slate-500">
              Use my location
            </button>
            <button type="button" disabled={busy} onClick={save} className="px-2 py-1 rounded-lg text-[11px] font-bold border border-orange-500/40 text-orange-500 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save zone'}
            </button>
          </div>
        </div>
      )}
      {status?.error && <p className="text-[11px] text-rose-500">{status.error}</p>}
      {status?.ok && <p className="text-[11px] text-emerald-500">{status.ok}</p>}
    </div>
  )
}
