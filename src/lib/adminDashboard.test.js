import test from 'node:test'
import assert from 'node:assert/strict'
import { average, pbVaultSummary, weekSeries, eventCount, toolUsageSummary, fallbackLabel, disciplineLabel, respectSummary, respectTiers, dayLabel, maxCount, orderProviders, pct, providerHealth, providerLabel, sumSeries, trend, withAllProviders } from './adminDashboard.js'

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

test('respectTiers buckets a per-activity histogram by RESPECT_LEVELS', () => {
  const t = respectTiers([{ count: 1, activities: 4 }, { count: 2, activities: 1 }, { count: 3, activities: 2 }, { count: 25, activities: 1 }, { count: 1500, activities: 1 }])
  const by = Object.fromEntries(t.map((r) => [r.word, r]))
  assert.equal(t.length, 10)
  assert.deepEqual([by.Nod.exact, by.Nod.atLeast], [5, 9])
  assert.deepEqual([by.Props.exact, by.Props.atLeast], [2, 4])
  assert.deepEqual([by.Beast.exact, by.Beast.atLeast], [1, 2])
  assert.deepEqual([by.Godlike.exact, by.Godlike.atLeast], [1, 1])
  assert.deepEqual(respectTiers(null).map((r) => r.exact), Array(10).fill(0))
})

test('PB Vault summary derives shares and the records-per-rider buckets', () => {
  const k = pbVaultSummary({ users_total: 20, riders: 5, records: 15, with_laps: 6, with_usable_laps: 3, pacing_eligible_riders: 2, distribution: { one: 2, two_to_five: 2, six_plus: 1 } })
  assert.equal(k.ridersPct, 25)
  assert.equal(k.lapsPct, 40)
  assert.equal(k.usableLapsPct, 20)
  assert.equal(k.pacingPct, 40)
  assert.equal(k.perRider, 3)
  assert.deepEqual(k.distribution.map((d) => d.count), [2, 2, 1])
  assert.equal(pbVaultSummary(null).ridersPct, 0)
})

test('tool usage helpers sum weekly events and labels', () => {
  const weeks = [{ week: '2027-01-04', gear_public: 2, gear_logged_in: 1, pursuit_public: 4, pursuit_logged_in: 0 }, { week: '2027-01-11', gear_public: 0, gear_logged_in: 3, pursuit_public: 1, pursuit_logged_in: 2 }]
  assert.deepEqual(weekSeries(weeks, 'gear_public', 'gear_logged_in'), [{ day: '2027-01-04', count: 3 }, { day: '2027-01-11', count: 3 }])
  const k = toolUsageSummary({ weeks, pursuit_plans_logged_in: 4, pursuit_plans_my_pacing: 1, pacing_fallbacks: [{ reason: 'no-records', count: 2 }, { reason: 'no-lap-data', count: 1 }] })
  assert.deepEqual(k, { gearTotal: 6, pursuitTotal: 7, myPacingPct: 25, fallbackTotal: 3 })
  const rows = [{ event: 'view', logged_in: true, count: 2 }, { event: 'view', logged_in: false, count: 5 }, { event: 'plan', logged_in: false, count: 1 }]
  assert.equal(eventCount(rows, 'view'), 7)
  assert.equal(eventCount(rows, 'view', false), 5)
  assert.equal(fallbackLabel('no-lap-data'), 'Records without usable lap data')
  assert.equal(disciplineLabel({ discipline: 'Pursuit', distance_m: 4000 }), 'Pursuit · 4000 m')
  assert.equal(disciplineLabel({ discipline: 'Pursuit' }), 'Pursuit')
  assert.equal(toolUsageSummary(undefined).myPacingPct, 0)
})
