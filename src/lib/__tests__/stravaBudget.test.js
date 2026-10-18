import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  window15Start, dayStart, normalizeBudget, parseBudgetHeaders, applyObservation, spend,
  remainingRequests, canSpend, budgetToRpcArgs, DEFAULT_LIMITS,
} from '../stravaBudget.js'

const now = new Date('2026-10-15T10:07:30Z')

test('windows reset at :00/:15/:30/:45 and at midnight UTC', () => {
  assert.equal(window15Start(now).toISOString(), '2026-10-15T10:00:00.000Z')
  assert.equal(window15Start(new Date('2026-10-15T10:15:00Z')).toISOString(), '2026-10-15T10:15:00.000Z')
  assert.equal(window15Start(new Date('2026-10-15T10:44:59Z')).toISOString(), '2026-10-15T10:30:00.000Z')
  assert.equal(dayStart(new Date('2026-10-15T23:59:59Z')), '2026-10-15')
  assert.equal(dayStart(new Date('2026-10-16T00:00:00Z')), '2026-10-16')
})

test('normalizeBudget: defaults, same window kept, rolled windows zeroed', () => {
  const empty = normalizeBudget(null, now)
  assert.deepEqual(empty.limits, DEFAULT_LIMITS)
  assert.equal(empty.read15m, 0)
  const row = {
    window_15m_start: '2026-10-15T10:00:00Z', window_day: '2026-10-15',
    read_15m_usage: 50, read_day_usage: 700, overall_15m_usage: 60, overall_day_usage: 800,
    read_15m_limit: 200, read_day_limit: 2000, overall_15m_limit: 400, overall_day_limit: 4000,
  }
  const same = normalizeBudget(row, now)
  assert.equal(same.read15m, 50)
  assert.equal(same.readDay, 700)
  const next15 = normalizeBudget(row, new Date('2026-10-15T10:15:01Z'))
  assert.equal(next15.read15m, 0)
  assert.equal(next15.overall15m, 0)
  assert.equal(next15.readDay, 700)
  const nextDay = normalizeBudget(row, new Date('2026-10-16T00:00:01Z'))
  assert.equal(nextDay.readDay, 0)
  assert.equal(nextDay.overallDay, 0)
})

test('parseBudgetHeaders reads read and overall headers', () => {
  const h = new Headers({
    'X-ReadRateLimit-Limit': '200,2000', 'X-ReadRateLimit-Usage': '12,345',
    'X-RateLimit-Limit': '400,4000', 'X-RateLimit-Usage': '20,400',
  })
  assert.deepEqual(parseBudgetHeaders(h), {
    read: { limit: [200, 2000], usage: [12, 345] },
    overall: { limit: [400, 4000], usage: [20, 400] },
  })
  assert.equal(parseBudgetHeaders(new Headers()), null)
  assert.equal(parseBudgetHeaders(new Headers({ 'X-ReadRateLimit-Limit': 'x' })), null)
  assert.deepEqual(parseBudgetHeaders({ 'x-ratelimit-limit': '1,2', 'x-ratelimit-usage': '0,1' }).overall.usage, [0, 1])
})

test('applyObservation only raises usage and adopts limits', () => {
  const b = { ...normalizeBudget(null, now), read15m: 30 }
  const up = applyObservation(b, { read: { limit: [100, 1000], usage: [45, 500] } })
  assert.equal(up.read15m, 45)
  assert.equal(up.readDay, 500)
  assert.equal(up.limits.read15m, 100)
  assert.equal(applyObservation(up, { read: { limit: [100, 1000], usage: [10, 10] } }).read15m, 45)
  assert.equal(applyObservation(b, null), b)
})

test('backfill gets 60% of the 15-minute and 70% of the daily read budget, live the rest', () => {
  const fresh = normalizeBudget(null, now)
  assert.equal(remainingRequests(fresh, 'backfill'), 120) // 60% of 200
  assert.equal(remainingRequests(fresh, 'live'), 197)
  const dayBound = { ...fresh, readDay: 1390 } // 70% of 2000 = 1400
  assert.equal(remainingRequests(dayBound, 'backfill'), 10)
  assert.equal(remainingRequests(dayBound, 'live'), 197)
  const spent = { ...fresh, read15m: 120 }
  assert.equal(canSpend(spent, 'backfill'), false)
  assert.equal(canSpend(spent, 'live', 10), true)
  assert.equal(remainingRequests({ ...fresh, read15m: 500 }, 'live'), 0)
})

test('overall budget also limits and spend counts everywhere', () => {
  const b = { ...normalizeBudget(null, now), overall15m: 240 } // 60% of 400
  assert.equal(canSpend(b, 'backfill'), false)
  const s = spend(normalizeBudget(null, now), 3)
  assert.deepEqual([s.read15m, s.readDay, s.overall15m, s.overallDay], [3, 3, 3, 3])
})

test('budgetToRpcArgs maps all counters', () => {
  const a = budgetToRpcArgs(spend(normalizeBudget(null, now), 2))
  assert.equal(a.p_read_15m_usage, 2)
  assert.equal(a.p_overall_day_limit, 4000)
})
