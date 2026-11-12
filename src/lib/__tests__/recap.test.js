import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecapYear, isValidSlug, bannerYear, buildRecapCards, headlineStats, recapShareUrl, isRecapSharePath } from '../recap.js'
import { trackRecapEvent, trackRecapCta, trackRecapSignUp, RECAP_CTA_KEY } from '../recapTracking.js'
import { CONSENT_KEY, buildConsentRecord } from '../consent.js'

const full = {
  year: 2026, ride_count: 40, active_days: 33, distance_km: 2100.4, hours: 80.5, elevation_m: 9000,
  longest_ride: { distance_km: 120, hours: 4.2, date: '2026-05-01' },
  best_power: { max_power_w: 1300, best_avg_power_w: 250, best_np_w: null },
  personal_bests: { count: 2, items: [{ discipline: '1km TT', event: null, time_seconds: 65.2 }] },
  longest_streak: { days: 5, start: '2026-06-01', end: '2026-06-05' },
  busiest_month: { month: 6, rides: 12, distance_km: 600 },
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, rides: 1, distance_km: 10 })),
  favorite_velodrome: { name: 'Třebešín', location: 'Praha', rides: 9 },
}

test('year and slug validation', () => {
  const now = new Date(Date.UTC(2026, 10, 12))
  assert.equal(parseRecapYear('2026', now), 2026)
  assert.equal(parseRecapYear('2027', now), null)
  assert.equal(parseRecapYear('26', now), null)
  assert.equal(parseRecapYear('1999', now), null)
  assert.ok(isValidSlug('0123456789abcdef0123'))
  assert.ok(!isValidSlug('0123456789ABCDEF0123') && !isValidSlug('short') && !isValidSlug(null))
  assert.ok(isRecapSharePath('/recap/s/abc') && !isRecapSharePath('/recap/2026'))
  assert.equal(recapShareUrl('abc', 'https://x.test'), 'https://x.test/recap/s/abc')
})

test('banner shows Oct-Feb only, for the right season', () => {
  assert.equal(bannerYear(new Date(Date.UTC(2026, 10, 12))), 2026)
  assert.equal(bannerYear(new Date(Date.UTC(2027, 0, 5))), 2026)
  assert.equal(bannerYear(new Date(Date.UTC(2027, 5, 5))), null)
})

test('cards cover full data and skip missing sections', () => {
  const ids = buildRecapCards(full, { name: 'Al' }).map((c) => c.id)
  assert.deepEqual(ids, ['intro', 'totals', 'longest', 'power', 'pbs', 'streak', 'month', 'velodrome'])
  const sparse = { year: 2026, ride_count: 3, active_days: 3, distance_km: null, hours: 1.5, elevation_m: null, longest_ride: null, best_power: null,
    personal_bests: { count: 0, items: [] }, longest_streak: { days: 1 }, busiest_month: { month: 2, rides: 2, distance_km: null }, months: [], favorite_velodrome: null }
  const cards = buildRecapCards(sparse)
  assert.deepEqual(cards.map((c) => c.id), ['intro', 'totals', 'month'])
  assert.ok(!cards[1].lines.join(' ').includes('km'))
  assert.deepEqual(buildRecapCards({ year: 2026, ride_count: 0 }).map((c) => c.id), ['intro', 'empty'])
  assert.deepEqual(headlineStats({ ride_count: 0 }), [])
  assert.equal(headlineStats(full)[0].value, '2,100 km')
})

function setupWindow(consent) {
  const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
  const calls = []
  global.window = {
    gtag: (...a) => calls.push(a),
    localStorage: store(consent ? { [CONSENT_KEY]: JSON.stringify(buildConsentRecord({ analytics: true })) } : {}),
    sessionStorage: store(),
  }
  return calls
}

test('recap events fire only with analytics consent', () => {
  let calls = setupWindow(false)
  assert.equal(trackRecapEvent('recap_view', { year: 2026 }), false)
  assert.equal(trackRecapCta(2026), false)
  assert.equal(window.sessionStorage.getItem(RECAP_CTA_KEY), null)
  assert.equal(calls.length, 0)

  calls = setupWindow(true)
  assert.equal(trackRecapEvent('bogus'), false)
  assert.equal(trackRecapEvent('recap_view', { year: 2026 }), true)
  assert.equal(trackRecapSignUp(), false)
  trackRecapCta(2026)
  assert.equal(trackRecapSignUp(), true)
  assert.equal(trackRecapSignUp(), false)
  assert.deepEqual(calls.map((c) => c[1]), ['recap_view', 'recap_cta_click', 'recap_signup'])
  delete global.window
})
