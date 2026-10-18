import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVelodromePayload, normalizeUrl } from '../velodromeSuggestions.js'

test('normalizeUrl adds https and rejects unsafe schemes', () => {
  assert.equal(normalizeUrl('example.com/a'), 'https://example.com/a')
  assert.equal(normalizeUrl(''), null)
  assert.equal(normalizeUrl('javascript:alert(1)'), undefined)
})

test('edit payload only contains changed fields', () => {
  const current = { name: 'Oderlandhalle', length_m: '250.00', website_url: null, notes: 'x' }
  const { payload } = buildVelodromePayload(
    { name: 'Oderlandhalle', length_m: '250', website_url: 'oderlandhalle.de', notes: 'x' },
    current
  )
  assert.deepEqual(payload, { website_url: 'https://oderlandhalle.de/' })
})

test('unchanged edit and invalid links are errors', () => {
  assert.ok(buildVelodromePayload({ name: 'A' }, { name: 'A' }).error)
  assert.ok(buildVelodromePayload({ pricing_url: 'ftp://x' }, { name: 'A' }).error)
})

test('new track requires name, length and surface', () => {
  assert.ok(buildVelodromePayload({ name: 'N', length_m: '', surface: 'Wood' }).error)
  const { payload } = buildVelodromePayload({ name: ' N ', length_m: '250', surface: 'Wood', is_indoor: true, notes: '' })
  assert.deepEqual(payload, { name: 'N', length_m: 250, surface: 'Wood', is_indoor: true })
})
