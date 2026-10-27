import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapDisciplineRow, disciplineFitsTrack, findDisciplineDistance, fetchDisciplines } from '../lookups.js'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261111000000_central_lookups.sql', import.meta.url),
  'utf8',
)

test('migration seeds the PB Vault disciplines', () => {
  for (const n of ['200m Flying', '4000m Team Pursuit', 'Madison']) assert.ok(migration.includes(`'${n}'`), n)
})

test('migration adds is_indoor and Oderlandhalle', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_indoor/)
  assert.match(migration, /'Oderlandhalle'/)
})

test('mapDisciplineRow + helpers', () => {
  const d = mapDisciplineRow({ id: '1', name: 'X', category: 'C', distance_m: '500.00', flying_start: false, min_track_length_m: '200' })
  assert.equal(d.distanceM, 500)
  assert.equal(disciplineFitsTrack(d, 250), true)
  assert.equal(disciplineFitsTrack(d, 150), false)
  assert.equal(findDisciplineDistance([d], 'X'), 500)
  assert.equal(findDisciplineDistance([d], 'Y'), null)
})

test('fetchDisciplines returns an empty list on error', async () => {
  const client = { from: () => ({ select: () => ({ order: async () => ({ data: null, error: new Error('x') }) }) }) }
  assert.deepEqual(await fetchDisciplines(client), [])
})

test('discipline suggestions are registered and can be applied by review_suggestion', () => {
  const m = readFileSync(
    new URL('../../../supabase/migrations/20261125000000_discipline_suggestions.sql', import.meta.url),
    'utf8',
  )
  assert.match(m, /'discipline'/)
  assert.match(m, /suggestion_targets/)
  assert.match(m, /allowed_columns/)
})

test('fetchTracks queries the tracks table ordered by name', async () => {
  const { fetchTracks } = await import('../lookups.js')
  const calls = []
  const q = {
    select: (c) => (calls.push(['select', c]), q),
    order: (c, o) => (calls.push(['order', c, o]), 'result'),
  }
  const sb = { from: (t) => (calls.push(['from', t]), q) }
  assert.equal(fetchTracks(sb), 'result')
  assert.deepEqual(calls[0], ['from', 'tracks'])
})

test('migration adds Oderlandhalle as a selectable GER track', () => {
  assert.match(migration, /Oderlandhalle[\s\S]*'GER'/)
})

test('mergeSurfaces uses the lookup, adds track surfaces, and falls back', async () => {
  const { mergeSurfaces, FALLBACK_SURFACES } = await import('../lookups.js')
  assert.deepEqual(mergeSurfaces([], []), FALLBACK_SURFACES)
  assert.ok(FALLBACK_SURFACES.includes('Aluminium'))
  assert.deepEqual(
    mergeSurfaces(['Wood', 'Aluminium'], [{ surface: 'aluminium' }, { surface: 'Glass' }, { surface: null }]),
    ['Wood', 'Aluminium', 'Glass'],
  )
})
