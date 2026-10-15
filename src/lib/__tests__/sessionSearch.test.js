import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSearchTerm, isSearchable, escapeIlike, parseDatePrefix, matchTrackIds, buildSessionSearch,
} from '../sessionSearch.js'

test('normalise and min length', () => {
  assert.equal(normalizeSearchTerm('  a   b '), 'a b')
  assert.equal(isSearchable('a'), false)
  assert.equal(isSearchable(' ab '), true)
  assert.equal(isSearchable(null), false)
})

test('escapeIlike strips filter syntax and escapes wildcards', () => {
  assert.equal(escapeIlike('a,b(c)'), 'a b c')
  assert.equal(escapeIlike('50%_x'), '50\\%\\_x')
})

test('parseDatePrefix', () => {
  assert.deepEqual(parseDatePrefix('2026-10'), { from: '2026-10-01', to: '2026-11-01' })
  assert.deepEqual(parseDatePrefix('2026-10-15'), { from: '2026-10-15', to: '2026-10-16' })
  assert.deepEqual(parseDatePrefix('2026-12'), { from: '2026-12-01', to: '2027-01-01' })
  assert.deepEqual(parseDatePrefix('2026'), { from: '2026-01-01', to: '2027-01-01' })
  assert.equal(parseDatePrefix('2026-13'), null)
  assert.equal(parseDatePrefix('2026-02-31'), null)
  assert.equal(parseDatePrefix('brno'), null)
})

test('matchTrackIds', () => {
  const tracks = [{ id: 1, name: 'Brno Velodrome' }, { id: 2, name: 'Ballerup' }]
  assert.deepEqual(matchTrackIds(tracks, 'BRNO'), [1])
  assert.deepEqual(matchTrackIds(tracks, ''), [])
})

test('buildSessionSearch', () => {
  const tracks = [{ id: 1, name: 'Brno Velodrome' }]
  assert.equal(buildSessionSearch('brno', tracks).orFilter, 'title.ilike.%brno%,track_id.in.(1)')
  assert.equal(buildSessionSearch('x,y', []).orFilter, 'title.ilike.%x y%')
  assert.ok(buildSessionSearch('2026-10', tracks).date)
  assert.equal(buildSessionSearch('2026-10', tracks).orFilter, null)
})
