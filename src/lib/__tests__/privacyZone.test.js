import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  haversineMeters,
  normalizeZone,
  validateZone,
  zoneSignature,
  applyPrivacyZone,
} from '../privacyZone.js'
import { buildFeedPreview, buildRoutePreview } from '../routePreview.js'
import { buildActivityInsert } from '../activityRecord.js'
import { SHARED_FEED_COLUMNS, FEED_ACTIVITY_COLUMNS } from '../activityPagination.js'
import { readFileSync } from 'node:fs'

const HOME = { lat: 50.0, lng: 14.0, radius: 300 }

test('haversine: ~111 m per 0.001 degree of latitude', () => {
  const d = haversineMeters(50, 14, 50.001, 14)
  assert.ok(d > 110 && d < 112)
  assert.equal(haversineMeters(50, 14, 50, 14), 0)
})

test('normalizeZone / validateZone', () => {
  assert.equal(normalizeZone(null), null)
  assert.equal(normalizeZone({ privacy_zone_lat: null, privacy_zone_lng: null, privacy_zone_radius_m: null }), null)
  assert.deepEqual(normalizeZone({ lat: '50.123456', lng: 14, radius: '200.4' }), { lat: 50.12346, lng: 14, radius: 200 })
  assert.equal(normalizeZone({ lat: 50, lng: 14, radius: 10 }), null)
  assert.equal(normalizeZone({ lat: 91, lng: 14, radius: 200 }), null)
  assert.ok(validateZone({ lat: '', lng: 1, radius: 200 }))
  assert.ok(validateZone({ lat: 1, lng: 181, radius: 200 }))
  assert.ok(validateZone({ lat: 1, lng: 1, radius: 6000 }))
  assert.equal(validateZone({ lat: 1, lng: 1, radius: 200 }), null)
})

test('zoneSignature matches the SQL zone_signature format', () => {
  assert.equal(zoneSignature(null), 'none')
  assert.equal(zoneSignature({ lat: 50.1, lng: -4.5, radius: 250 }), 'z50.10000x-4.50000x250')
  const sql = readFileSync(new URL('../../../supabase/migrations/20261015000000_privacy_zone_shared_view.sql', import.meta.url), 'utf8')
  assert.match(sql, /'z' \|\| round\(p_lat, 5\)::text \|\| 'x' \|\| round\(p_lng, 5\)::text \|\| 'x' \|\| p_radius::text/)
})

test('applyPrivacyZone drops every sample inside the zone, keeping indexes aligned', () => {
  const lat = [50.0, 50.001, 50.02, 50.0005, 50.03]
  const lng = [14.0, 14.0, 14.0, 14.0, 14.0]
  const out = applyPrivacyZone(lat, lng, HOME)
  assert.deepEqual(out.latitude, [null, null, 50.02, null, 50.03])
  assert.equal(out.latitude.length, lat.length)
  // No zone: untouched
  assert.deepEqual(applyPrivacyZone(lat, lng, null).latitude, lat)
})

test('route preview excludes the zone: start/end near home are trimmed', () => {
  // Ride from home out and back: first/last samples are inside the 300 m zone.
  const lat = [], lng = []
  for (let i = 0; i <= 20; i++) { lat.push(50 + i * 0.001); lng.push(14) }
  for (let i = 19; i >= 0; i--) { lat.push(50 + i * 0.001); lng.push(14.0005) }
  const full = buildRoutePreview(lat, lng)
  const trimmed = buildFeedPreview({ latitude: lat, longitude: lng }, HOME)
  assert.equal(trimmed.kind, 'route')
  assert.ok(trimmed.points.length >= 2)
  // The trimmed route's bounding box starts ~300 m north of home: compare projected extents
  const viaApply = applyPrivacyZone(lat, lng, HOME)
  const kept = viaApply.latitude.filter((v) => v != null)
  assert.ok(kept.every((v, i) => haversineMeters(50, 14, v, viaApply.longitude.filter((x) => x != null)[i]) > 300))
  assert.ok(kept.length < lat.length)
  assert.ok(full.points.length >= 2)
})

test('a ride entirely inside the zone yields no route (falls back to sparkline/none)', () => {
  const lat = [50.0001, 50.0002, 50.0003]
  const lng = [14.0001, 14.0002, 14.0003]
  assert.deepEqual(buildFeedPreview({ latitude: lat, longitude: lng }, HOME), { kind: 'none' })
  const watts = Array.from({ length: 20 }, (_, i) => 100 + i)
  assert.equal(buildFeedPreview({ latitude: lat, longitude: lng, watts }, HOME).kind, 'sparkline')
})

test('buildActivityInsert applies the zone and stamps the signature', () => {
  const lat = [50.0, 50.0001, 50.05, 50.06]
  const lng = [14.0, 14.0, 14.05, 14.06]
  const insert = buildActivityInsert({}, { userId: 'u', timeSeries: { latitude: lat, longitude: lng }, privacyZone: HOME })
  assert.equal(insert.route_preview_zone, zoneSignature(HOME))
  assert.equal(insert.route_preview.kind, 'route')
  assert.equal(buildActivityInsert({}, { userId: 'u' }).route_preview_zone, 'none')
})

test('shared feed columns never include the raw file and use the JSON tracks column', () => {
  assert.ok(FEED_ACTIVITY_COLUMNS.includes('raw_file_url'))
  assert.ok(!SHARED_FEED_COLUMNS.includes('raw_file_url'))
  assert.ok(SHARED_FEED_COLUMNS.split(', ').includes('tracks'))
  assert.ok(!SHARED_FEED_COLUMNS.includes('tracks('))
})

test('migration closes the GPS hole: shared policy dropped, view strips GPS and sensitive columns', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261015000000_privacy_zone_shared_view.sql', import.meta.url), 'utf8')
  assert.match(sql, /DROP POLICY IF EXISTS "activities_select_shared" ON public\.activities;/)
  assert.ok(!/CREATE POLICY "activities_select_shared"/.test(sql))
  const view = sql.slice(sql.indexOf('CREATE VIEW public.shared_activities'))
  assert.match(view, /time_series - 'latitude' - 'longitude'/)
  for (const col of ['raw_file_url', 'file_sha256', 'ftp_at_activity_w']) {
    assert.ok(!new RegExp(`a\\.${col}`).test(view), `${col} must not be exposed`)
  }
  assert.ok(!/a\.time_series,/.test(view))
  assert.match(view, /is_blocked_between\(auth\.uid\(\), a\.user_id\)/)
  assert.match(view, /GRANT SELECT ON public\.shared_activities TO authenticated/)
  assert.match(sql, /can_view_activity\(activity_id\)/)
})
