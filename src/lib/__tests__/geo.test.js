import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withSlugs, isIndexableTrack } from '../trackSlug.js'
import { isPublicContentPath } from '../publicPaths.js'
import { faqJsonLd, organizationJsonLd, trackJsonLd } from '../geo.js'
import { llmsTxt } from '../llms.js'
import { PUBLIC_PATHS, PRIVATE_PATHS } from '../seo.js'

const t = { id: 'abcdef12-0000', name: 'Vélodrome de Saint-Quentin', country_code: 'FRA', length_m: 250, surface: 'Wood', is_indoor: true }

test('slugs are stable, ascii and unique', () => {
  const [a, b, c] = withSlugs([t, { ...t, id: 'ffffffff-1' }, { ...t, name: 'Other' }])
  assert.match(a.slug, /^velodrome-de-saint-quentin-fra-abcdef12$/)
  assert.notEqual(a.slug, b.slug)
  assert.equal(c.slug, 'other-fra')
})

test('indexable needs key data', () => {
  assert.equal(isIndexableTrack(t), true)
  assert.equal(isIndexableTrack({ ...t, surface: null }), false)
})

test('public paths', () => {
  assert.ok(isPublicContentPath('/velodromes/foo'))
  assert.ok(isPublicContentPath('/about/'))
  assert.ok(!isPublicContentPath('/templates'))
  assert.ok(PUBLIC_PATHS.includes('/velodromes') && !PRIVATE_PATHS.includes('/velodromes'))
})

test('json-ld has no sameAs on the organization and valid FAQ/track shapes', () => {
  assert.equal(organizationJsonLd().sameAs, undefined)
  assert.equal(faqJsonLd().mainEntity[0]['@type'], 'Question')
  const [s] = withSlugs([t])
  assert.equal(trackJsonLd(s, 'France')['@type'], 'SportsActivityLocation')
})

test('llms.txt lists pages and tracks', () => {
  const out = llmsTxt(withSlugs([t]))
  assert.match(out, /^# VelocityStack/)
  assert.match(out, /\/velodromes\/velodrome-de-saint-quentin-fra/)
})
