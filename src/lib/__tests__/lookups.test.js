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
