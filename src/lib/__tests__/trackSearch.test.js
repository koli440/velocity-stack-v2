import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterTracks, formatTrackMeta } from '../trackSearch.js'

const tracks = [
  { id: 1, name: 'Ballerup Super Arena', location: 'Copenhagen', country_code: 'DNK', length_m: 250, surface: 'Wood' },
  { id: 2, name: 'Vélodrome de Saint-Quentin', location: 'Paris', country_code: 'FRA', length_m: 250, surface: 'Wood' },
  { id: 3, name: 'Brno Velodrome', location: 'Brno', country_code: 'CZE', length_m: 333, surface: 'Concrete' },
]

test('empty query returns all tracks sorted by name', () => {
  assert.deepEqual(filterTracks(tracks, '').map((t) => t.id), [1, 3, 2])
})

test('matches accent-insensitively and across fields', () => {
  assert.deepEqual(filterTracks(tracks, 'velodrome').map((t) => t.id), [3, 2])
  assert.deepEqual(filterTracks(tracks, 'paris').map((t) => t.id), [2])
  assert.deepEqual(filterTracks(tracks, 'dnk').map((t) => t.id), [1])
  assert.deepEqual(filterTracks(tracks, '333 concrete').map((t) => t.id), [3])
})

test('name-prefix matches rank before other matches', () => {
  assert.equal(filterTracks(tracks, 'brno')[0].id, 3)
  assert.deepEqual(filterTracks(tracks, 'zzz'), [])
})

test('formatTrackMeta skips missing parts', () => {
  assert.equal(formatTrackMeta(tracks[0]), 'Copenhagen · DNK · 250 m · Wood')
  assert.equal(formatTrackMeta({ name: 'x' }), '')
})

test('favorite track is pinned first, and wins ties', () => {
  assert.deepEqual(filterTracks(tracks, '', 2).map((t) => t.id), [2, 1, 3])
  assert.deepEqual(filterTracks(tracks, 'velodrome', 2).map((t) => t.id), [2, 3])
})
