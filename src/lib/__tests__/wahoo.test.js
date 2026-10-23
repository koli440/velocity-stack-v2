// Run with: node --test src/lib/__tests__/wahoo.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenNeedsRefresh, tokensToColumns, filterWahooRides, mapWahooWorkout, matchesWebhookToken, parseWebhookEvent,
  parseRateLimit, isRateLimitNear, isRevokedGrant,
} from '../wahoo.js'
import { resolveDuplicate } from '../activityDuplicates.js'

const workout = {
  id: 77,
  starts: '2027-01-05T07:30:00.000Z',
  workout_type_id: 0,
  workout_summary: {
    duration_total_accum: '3605.2',
    duration_active_accum: '3500',
    distance_accum: '30123.4',
    power_avg: '180',
    time_zone: 'Europe/Amsterdam',
    manual: false,
    file: { url: 'https://cdn.example/f.fit' },
  },
}

test('tokensToColumns uses created_at + expires_in', () => {
  const c = tokensToColumns({ access_token: 'a', refresh_token: 'r', expires_in: 7200, created_at: 1000 })
  assert.equal(c.token_expires_at, new Date((1000 + 7200) * 1000).toISOString())
  assert.equal(tokensToColumns({ access_token: 'a' }), null)
})

test('tokenNeedsRefresh refreshes inside the skew only', () => {
  const now = Date.parse('2027-01-05T00:00:00Z')
  assert.equal(tokenNeedsRefresh(new Date(now + 30000).toISOString(), now), true)
  assert.equal(tokenNeedsRefresh(new Date(now + 3600000).toISOString(), now), false)
  assert.equal(tokenNeedsRefresh(null, now), true)
})

test('isRevokedGrant', () => {
  assert.equal(isRevokedGrant(401, null), true)
  assert.equal(isRevokedGrant(500, null), false)
})

test('workouts map to rides; manual and file-less workouts are skipped', () => {
  const [ride] = filterWahooRides([workout, { ...workout, id: 2, workout_summary: { ...workout.workout_summary, manual: true } }, { id: 3, starts: workout.starts, workout_type_id: 0, workout_summary: {} }])
  assert.equal(filterWahooRides([workout]).length, 1)
  assert.equal(ride.id, '77')
  assert.equal(ride.elapsed_time_s, 3605)
  assert.equal(ride.start_time, '2027-01-05T07:30:00.000Z')
  assert.equal(ride.start_date_local.slice(0, 16), '2027-01-05T08:30')
  assert.equal(mapWahooWorkout(workout).file_url, 'https://cdn.example/f.fit')
})

test('webhook token check and event parsing', () => {
  assert.equal(matchesWebhookToken('abc', 'abc'), true)
  assert.equal(matchesWebhookToken('abd', 'abc'), false)
  assert.equal(matchesWebhookToken(undefined, 'abc'), false)
  const ev = parseWebhookEvent({ event_type: 'workout_summary', user: { id: 5 }, workout_summary: { id: 9, workout: { id: 77 } } })
  assert.deepEqual(ev, { kind: 'workout_summary', userId: '5', workoutId: '77', summaryId: '9' })
  assert.equal(parseWebhookEvent({ event_type: 'other' }).kind, 'ignore')
})

test('rate limit headers', () => {
  const rl = parseRateLimit({ 'x-ratelimit-limit': '5000, 1000, 200', 'x-ratelimit-remaining': '4999, 2, 199' })
  assert.deepEqual(rl.remaining, [4999, 2, 199])
  assert.equal(isRateLimitNear(rl), true)
  assert.equal(parseRateLimit({}), null)
})

test('duplicate priority: wahoo replaces strava, ties with intervals are skipped', () => {
  assert.equal(resolveDuplicate({ source: 'wahoo' }, { source: 'strava' }), 'upgrade')
  assert.equal(resolveDuplicate({ source: 'wahoo' }, { source: 'intervals' }), 'skip')
  assert.equal(resolveDuplicate({ source: 'strava' }, { source: 'wahoo' }), 'skip')
})
