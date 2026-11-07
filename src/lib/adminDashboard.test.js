import test from 'node:test'
import assert from 'node:assert/strict'
import { average, respectSummary, dayLabel, maxCount, orderProviders, pct, providerHealth, providerLabel, sumSeries, trend, withAllProviders } from './adminDashboard.js'

const S = [1, 2, 3, 4].map((count, i) => ({ day: `2027-01-0${i + 1}`, count }))

test('sums, maxima and percentages are safe on empty input', () => {
  assert.equal(sumSeries(S), 10)
  assert.equal(sumSeries(null), 0)
  assert.equal(maxCount([]), 1)
  assert.equal(maxCount(S), 4)
  assert.equal(pct(1, 3), 33)
  assert.equal(pct(5, 0), 0)
})

test('trend compares the later half with the earlier half', () => {
  assert.deepEqual(trend(S), { current: 7, previous: 3, delta: 4, direction: 'up' })
  assert.equal(trend([{ count: 5 }, { count: 1 }]).direction, 'down')
  assert.equal(trend([]).direction, 'flat')
})

test('provider health prefers errors, then stale, then idle', () => {
  assert.equal(providerHealth({ connected: 3, errors: 1, stale: 2 }), 'error')
  assert.equal(providerHealth({ connected: 3, errors: 0, stale: 2 }), 'warn')
  assert.equal(providerHealth({ connected: 3, errors: 0, stale: 0 }), 'ok')
  assert.equal(providerHealth({ connected: 0, errors: 0, stale: 0 }), 'idle')
  assert.equal(providerHealth(null), 'idle')
})

test('providers are ordered and always include the four integrations', () => {
  const rows = withAllProviders([{ provider: 'zeta', connected: 1 }, { provider: 'wahoo', connected: 2 }])
  assert.deepEqual(rows.map((r) => r.provider), ['garmin', 'wahoo', 'intervals', 'strava', 'zeta'])
  assert.equal(rows[1].connected, 2)
  assert.deepEqual(orderProviders([{ provider: 'strava' }, { provider: 'garmin' }]).map((r) => r.provider), ['garmin', 'strava'])
})

test('labels', () => {
  assert.equal(providerLabel('intervals'), 'Intervals.icu')
  assert.equal(providerLabel('polar'), 'Polar')
  assert.equal(dayLabel('2027-03-09'), '9/3')
})

import { failureRate, partnerAppHealth } from './adminDashboard.js'

test('partner failure rate and health', () => {
  assert.equal(failureRate({ imported: 6, duplicate: 2, failed: 2 }), 20)
  assert.equal(failureRate({}), 0)
  assert.equal(partnerAppHealth({ status: 'approved', imported: 10, failed: 0 }), 'ok')
  assert.equal(partnerAppHealth({ status: 'approved', imported: 5, failed: 5 }), 'warn')
  assert.equal(partnerAppHealth({ status: 'approved', imported: 5, failed: 0, reuse_revocations: 1 }), 'warn')
  assert.equal(partnerAppHealth({ status: 'suspended' }), 'suspended')
})

test('average rounds to one decimal and is safe on zero', () => {
  assert.equal(average(7, 3), 2.3)
  assert.equal(average(5, 0), 0)
  assert.equal(average(undefined, 2), 0)
})

test('respectSummary derives shares from the RPC payload', () => {
  const r = respectSummary({ total: 10, activities: 4, active_users: 8, active_gave: 2, active_received: 4, by_visibility: { public: 3, non_public: 1 }, notified_reactions: 5 })
  assert.deepEqual(r, { perActivity: 2.5, gavePct: 25, receivedPct: 50, publicPct: 75, notifiedPct: 50 })
  assert.deepEqual(respectSummary(null), { perActivity: 0, gavePct: 0, receivedPct: 0, publicPct: 0, notifiedPct: 0 })
})
