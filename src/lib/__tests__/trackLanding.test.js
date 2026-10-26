import test from 'node:test'
import assert from 'node:assert/strict'
import { carryQuery, isLandingPath, trackJsonLd, jsonLdString, TRACK_DESCRIPTION } from '../trackLanding.js'
import { PUBLIC_PATHS, PRIVATE_PATHS } from '../seo.js'

test('carryQuery keeps UTM params untouched', () => {
  const s = '?utm_source=google&utm_medium=cpc&utm_campaign=track%20cycling&gclid=abc_123'
  assert.equal(carryQuery('/register', s), `/register${s}`)
  assert.equal(carryQuery('/login', s.slice(1)), `/login${s}`)
})

test('carryQuery merges with an existing query and hash', () => {
  assert.equal(carryQuery('/login?next=/x#a', '?utm_source=g'), '/login?next=/x&utm_source=g#a')
})

test('carryQuery is a no-op without a query or for external links', () => {
  assert.equal(carryQuery('/register', ''), '/register')
  assert.equal(carryQuery('/register', null), '/register')
  assert.equal(carryQuery('https://example.com', '?a=1'), 'https://example.com')
})

test('isLandingPath', () => {
  assert.ok(isLandingPath('/track'))
  assert.ok(isLandingPath('/track/'))
  assert.ok(!isLandingPath('/tracks'))
  assert.ok(!isLandingPath('/velodromes'))
})

test('/track is indexable (public, not private)', () => {
  assert.ok(PUBLIC_PATHS.includes('/track'))
  assert.ok(!PRIVATE_PATHS.some((p) => '/track'.startsWith(p)))
})

test('JSON-LD has no pricing and is script-safe', () => {
  const ld = trackJsonLd()
  assert.equal(ld['@type'], 'SoftwareApplication')
  assert.equal(ld.offers, undefined)
  assert.ok(!jsonLdString({ a: '</script>' }).includes('</script>'))
  assert.ok(!/free|price|€|\$/i.test(JSON.stringify(ld)))
  assert.ok(TRACK_DESCRIPTION.length <= 200)
})
