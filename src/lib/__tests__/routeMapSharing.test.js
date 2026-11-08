import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { routeSegments, normalizeRouteMapSharing, ROUTE_MAP_SHARING } from '../routeMapSharing.js'
import { haversineMeters } from '../privacyZone.js'

const migration = fs.readFileSync(new URL('../../../supabase/migrations/20270142000000_shared_route_map.sql', import.meta.url), 'utf8')

test('routeSegments splits at hidden (null) samples instead of bridging them', () => {
  const s = routeSegments([1, 2, null, 4, 5, 6], [1, 2, null, 4, 5, 6])
  assert.deepEqual(s, [[[1, 1], [2, 2]], [[4, 4], [5, 5], [6, 6]]])
})

test('routeSegments drops single points, (0,0) and bad input', () => {
  assert.deepEqual(routeSegments([1, null, 2], [1, null, 2]), [])
  assert.deepEqual(routeSegments([0, 0], [0, 0]), [])
  assert.deepEqual(routeSegments(undefined, undefined), [])
  assert.deepEqual(routeSegments(['x', NaN], [1, 1]), [])
})

test('zone leak: after server trimming no drawn point is inside the zone', () => {
  const zone = { lat: 50, lng: 14, r: 300 }
  const lat = [], lng = []
  for (let i = 0; i < 200; i++) { lat.push(50 + i * 0.0001); lng.push(14) }
  // same rule as trim_gps_to_zone: inside the radius becomes null
  const tl = lat.map((v, i) => (haversineMeters(v, lng[i], zone.lat, zone.lng) <= zone.r ? null : v))
  const tn = lng.map((v, i) => (tl[i] === null ? null : v))
  const pts = routeSegments(tl, tn).flat()
  assert.ok(pts.length > 0 && pts.length < 200)
  for (const [a, b] of pts) assert.ok(haversineMeters(a, b, zone.lat, zone.lng) > zone.r)
})

test('normalizeRouteMapSharing defaults to the default (public, opt-out) mode', () => {
  assert.equal(normalizeRouteMapSharing('nonsense'), 'public')
  assert.equal(normalizeRouteMapSharing(null), 'public')
  for (const k of Object.keys(ROUTE_MAP_SHARING)) assert.equal(normalizeRouteMapSharing(k), k)
})

test('migration: shared_activities only exposes GPS via shared_route_gps, never the raw series', () => {
  const view = migration.slice(migration.indexOf('CREATE OR REPLACE VIEW public.shared_activities'))
  assert.match(view, /shared_route_gps\(/)
  assert.match(view, /- 'latitude' - 'longitude'/)
  assert.match(view, /can_view_route_map\(/)
  assert.doesNotMatch(view, /a\.time_series,/)
  assert.match(migration, /trim_gps_to_zone\(/)
  assert.match(migration, /DEFAULT 'public'/)
})
