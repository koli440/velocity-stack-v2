import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatPriceRange, priceRangeLd, publicPhone, openingHoursLd, hasTrackInfo, isClosed, formatVerifiedDate } from '../trackInfo.js'
import { trackJsonLd } from '../geo.js'

const base = { id: 'a', slug: 'x-fra', name: 'X', country_code: 'FRA', length_m: 250, surface: 'Wood', is_indoor: true }
const info = { price_min: 12, price_max: 47.2, price_currency: 'GBP', phone: '+44 20 1', contact_is_organisational: true, opening_hours_spec: 'Mo-Fr 06:00-22:00; Sa-Su 07:00-20:00' }

test('price range formatting', () => {
  assert.equal(formatPriceRange(base), null)
  assert.equal(formatPriceRange({ ...base, price_min: 15, price_max: 15, price_currency: 'EUR' }), '€15')
  assert.equal(formatPriceRange({ ...base, ...info }), '£12 – £47.20')
  assert.equal(formatPriceRange({ ...base, price_min: 10, price_currency: 'USD' }), 'from $10')
  assert.equal(formatPriceRange({ ...base, price_min: 10 }), null)
  assert.equal(priceRangeLd({ ...base, ...info }), '£12-£47.20')
})

test('phone is public only when flagged organisational', () => {
  assert.equal(publicPhone({ phone: '1', contact_is_organisational: false }), null)
  assert.equal(publicPhone({ phone: '+1', contact_is_organisational: true }), '+1')
})

test('opening hours spec splits into schema.org entries', () => {
  assert.deepEqual(openingHoursLd({ ...base, ...info }), ['Mo-Fr 06:00-22:00', 'Sa-Su 07:00-20:00'])
  assert.equal(openingHoursLd({ ...base, opening_hours: 'free text only' }), null)
})

test('json-ld is unchanged without data and enriched with it', () => {
  const plain = trackJsonLd(base, 'France')
  for (const k of ['telephone', 'openingHours', 'priceRange']) assert.ok(!(k in plain))
  const rich = trackJsonLd({ ...base, ...info, website_url: 'https://v.example/' }, 'France')
  assert.equal(rich.telephone, '+44 20 1')
  assert.equal(rich.priceRange, '£12-£47.20')
  assert.equal(rich.openingHours.length, 2)
  assert.deepEqual(rich.sameAs, ['https://v.example/'])
})

test('closed venues export no hours, price or phone and are flagged', () => {
  const closed = { ...base, ...info, operating_status: 'closed' }
  assert.ok(isClosed(closed))
  const ld = trackJsonLd(closed, 'France')
  for (const k of ['telephone', 'openingHours', 'priceRange']) assert.ok(!(k in ld))
  assert.equal(formatPriceRange(closed), null)
})

test('hasTrackInfo and verified date', () => {
  assert.equal(hasTrackInfo(base), false)
  assert.equal(hasTrackInfo({ ...base, operator: 'Council' }), true)
  assert.equal(formatVerifiedDate('2026-11-05T00:00:00Z'), '2026-11-05')
  assert.equal(formatVerifiedDate('garbage'), null)
})

test('public track select never loads email', () => {
  const src = readFileSync(new URL('../server/publicTracks.js', import.meta.url), 'utf8')
  const fields = src.match(/PUBLIC_TRACK_FIELDS =\s*'([^']+)'/)[1]
  assert.ok(!/\bemail\b/.test(fields))
  assert.ok(/contact_is_organisational/.test(fields))
})

test('track info migration enforces the privacy and provenance rules', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20270135000000_velodrome_track_info.sql', import.meta.url), 'utf8')
  assert.match(sql, /\(phone IS NULL AND email IS NULL\) OR contact_is_organisational/)
  assert.match(sql, /track_info_sources ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.track_info_sources FROM anon, authenticated/)
  assert.match(sql, /FOR SELECT TO anon, authenticated USING \(is_current AND status = 'verified'\)/)
  assert.match(sql, /source_url ~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/)
  assert.match(sql, /'not_found'/)
  const allowed = sql.match(/ARRAY\[([\s\S]*?)\]\n\)/)[1]
  for (const k of ['operator', 'year_built', 'opening_hours', 'price_min', 'operating_status']) assert.ok(allowed.includes(`'${k}'`))
  for (const k of ['phone', 'email', 'contact_is_organisational']) assert.ok(!allowed.includes(`'${k}'`))
  assert.ok(!/ADD COLUMN IF NOT EXISTS (website_url|pricing_url|booking_url)/.test(sql))
})
