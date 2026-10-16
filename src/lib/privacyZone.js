// GPS privacy zone (issue #49): a circle (e.g. around home) whose GPS points are never
// shared with other riders. Applied to persisted route previews; raw GPS is never exposed
// to other riders at all (see supabase/migrations/20261015000000_privacy_zone_shared_view.sql).

import { MIN_ZONE_RADIUS_M, MAX_ZONE_RADIUS_M, DEFAULT_ZONE_RADIUS_M, EARTH_RADIUS_M } from './constants.js'

export { MIN_ZONE_RADIUS_M, MAX_ZONE_RADIUS_M, DEFAULT_ZONE_RADIUS_M }

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Normalises DB columns / form values to `{ lat, lng, radius }`, or null when disabled/invalid. */
export function normalizeZone(zone) {
  if (!zone) return null
  const lat = Number(zone.lat ?? zone.privacy_zone_lat)
  const lng = Number(zone.lng ?? zone.privacy_zone_lng)
  const radius = Number(zone.radius ?? zone.privacy_zone_radius_m)
  if (
    zone.lat == null && zone.privacy_zone_lat == null
  ) {
    return null
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  if (radius < MIN_ZONE_RADIUS_M || radius > MAX_ZONE_RADIUS_M) return null
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, radius: Math.round(radius) }
}

/** Returns an error message, or null if the zone is valid. */
export function validateZone(zone) {
  if (!zone || [zone.lat, zone.lng, zone.radius].some((v) => v === '' || v == null || !Number.isFinite(Number(v)))) {
    return 'Enter latitude, longitude and radius'
  }
  if (Math.abs(Number(zone.lat)) > 90) return 'Latitude must be between -90 and 90'
  if (Math.abs(Number(zone.lng)) > 180) return 'Longitude must be between -180 and 180'
  const r = Number(zone.radius)
  if (r < MIN_ZONE_RADIUS_M || r > MAX_ZONE_RADIUS_M) {
    return `Radius must be between ${MIN_ZONE_RADIUS_M} and ${MAX_ZONE_RADIUS_M} m`
  }
  return null
}

/**
 * Identifies the zone a preview was built with. MUST match public.zone_signature() in SQL:
 * 'none' without a zone, otherwise z<lat,5dp>x<lng,5dp>x<radius>.
 */
export function zoneSignature(zone) {
  const z = normalizeZone(zone)
  if (!z) return 'none'
  return `z${z.lat.toFixed(5)}x${z.lng.toFixed(5)}x${z.radius}`
}

/**
 * Drops every GPS sample inside the zone (start, end and anywhere else the route passes
 * through it). Samples are replaced by null so arrays stay index-aligned.
 */
export function applyPrivacyZone(latitude, longitude, zone) {
  const z = normalizeZone(zone)
  if (!z || !Array.isArray(latitude) || !Array.isArray(longitude)) return { latitude, longitude }
  const len = Math.min(latitude.length, longitude.length)
  const lat = new Array(len)
  const lng = new Array(len)
  for (let i = 0; i < len; i++) {
    const la = latitude[i]
    const lo = longitude[i]
    const inside =
      Number.isFinite(la) && Number.isFinite(lo) && haversineMeters(z.lat, z.lng, la, lo) <= z.radius
    lat[i] = inside ? null : la
    lng[i] = inside ? null : lo
  }
  return { latitude: lat, longitude: lng }
}

export function zoneFromProfile(profile) {
  return normalizeZone(profile)
}
