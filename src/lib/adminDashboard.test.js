import test from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, maxCount, orderProviders, pct, providerHealth, providerLabel, sumSeries, trend, withAllProviders } from './adminDashboard.js'

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
