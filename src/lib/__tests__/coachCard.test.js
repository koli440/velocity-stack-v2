import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../coachCard.js'

test('suggestSlug normalises names', () => {
  assert.equal(c.suggestSlug("Ann O'Neil"), 'ann-oneil')
  assert.equal(c.suggestSlug('Zoë Müller'), 'zoe-muller')
  assert.equal(c.suggestSlug('Al'), '')
  assert.equal(c.suggestSlug('x'.repeat(50)).length, 30)
})

test('isValidSlug mirrors the DB check', () => {
  for (const ok of ['abc', 'a-b', 'speedy-coach', 'a1b']) assert.ok(c.isValidSlug(ok), ok)
  for (const bad of ['ab', '-ab', 'ab-', 'Ab_c', 'a'.repeat(31), '', null]) assert.ok(!c.isValidSlug(bad), String(bad))
})

test('priceLabel', () => {
  assert.equal(c.priceLabel({ kind: 'free' }), 'Free')
  assert.equal(c.priceLabel({ kind: 'subscription', interval: 'month', amount_cents: 8000, currency: 'eur' }), 'EUR 80 / month')
  assert.equal(c.priceLabel({ kind: 'one_time', amount_cents: 1250, currency: 'gbp' }), 'GBP 12.50')
  assert.equal(c.priceLabel({ kind: 'one_time', amount_cents: null }), null)
})

test('validateCard', () => {
  const base = { slug: 'speedy', headline: 'h', bio: 'b' }
  assert.equal(c.validateCard(base), null)
  assert.ok(c.validateCard({ ...base, slug: 'x' }))
  assert.ok(c.validateCard({ ...base, headline: 'x'.repeat(81) }))
  assert.ok(c.validateCard({ ...base, accent: 'pink' }))
  assert.ok(c.validateCard({ ...base, packages: Array(7).fill({ title: 't', kind: 'free' }) }))
  assert.ok(c.validateCard({ ...base, packages: [{ title: 't', kind: 'subscription', amount_cents: 1 }] }))
  assert.ok(c.validateCard({ ...base, packages: [{ title: 't', kind: 'one_time', amount_cents: -5 }] }))
  assert.equal(c.validateCard({ ...base, packages: [{ title: 't', kind: 'subscription', interval: 'month', amount_cents: 500 }] }), null)
})

test('parseList trims, dedupes and caps', () => {
  assert.deepEqual(c.parseList(' track, road ,track,,'), ['track', 'road'])
  assert.equal(c.parseList('1,2,3,4,5,6,7,8,9,10').length, 8)
})

test('accentOf falls back to orange and every accent has a hex colour', () => {
  assert.equal(c.accentOf('nope'), c.ACCENTS.orange)
  for (const a of Object.values(c.ACCENTS)) assert.match(a.hex, /^#[0-9a-f]{6}$/)
})

test('directoryQuery and urls', () => {
  assert.equal(c.directoryQuery({}), '/coaches')
  assert.equal(c.directoryQuery({ q: 'ann', discipline: 'track' }), '/coaches?q=ann&discipline=track')
  assert.equal(c.cardPath('abc'), '/c/abc')
  assert.match(c.cardUrl('abc'), /^https:\/\/.+\/c\/abc$/)
})

test('error messages', () => {
  assert.match(c.coachCardErrorMessage({ message: 'This link name is already taken' }), /taken/)
  assert.equal(c.coachCardErrorMessage({ message: '?' }), 'Something went wrong. Please try again.')
})
