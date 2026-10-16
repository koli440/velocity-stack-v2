import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DISCIPLINES } from '../pbVault.js'
import { mapDisciplineRow, disciplineFitsTrack, findDisciplineDistance, fetchDisciplines } from '../lookups.js'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261111000000_central_lookups.sql', import.meta.url),
  'utf8',
)

test('migration seeds every fallback discipline', () => {
  for (const d of DISCIPLINES) assert.ok(migration.includes(`'${d.name}', '${d.category}', ${d.distanceM}`), d.name)
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

test('fetchDisciplines falls back to the static list on error', async () => {
  const client = { from: () => ({ select: () => ({ order: async () => ({ data: null, error: new Error('x') }) }) }) }
  assert.equal(await fetchDisciplines(client), DISCIPLINES)
})
