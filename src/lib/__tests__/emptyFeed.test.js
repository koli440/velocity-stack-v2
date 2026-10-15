import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyFeedState, stravaFlagMessage } from '../emptyFeed.js'
import { signState, verifyState, stravaReturnPath } from '../strava.js'

const base = { activityCount: 0, activitiesLoaded: true }
const synced = { provider: 'strava', status: 'active', last_synced_at: '2026-01-01T00:00:00Z', backfill_complete: true }

test('hidden while loading or when activities exist', () => {
  assert.equal(emptyFeedState({ ...base, connections: [] , activitiesLoaded: false }), 'hidden')
  assert.equal(emptyFeedState({ ...base, connections: null }), 'hidden')
  assert.equal(emptyFeedState({ ...base, activityCount: 3, connections: [] }), 'hidden')
})

test('connect when nothing is connected', () => {
  assert.equal(emptyFeedState({ ...base, connections: [] }), 'connect')
  assert.equal(emptyFeedState({ ...base, connections: [{ status: 'disconnected' }] }), 'connect')
})

test('importing while backfill runs or first sync is pending', () => {
  assert.equal(emptyFeedState({ ...base, connections: [{ ...synced, backfill_complete: false }] }), 'importing')
  assert.equal(emptyFeedState({ ...base, connections: [{ status: 'active', last_synced_at: null }] }), 'importing')
})

test('connected-empty after sync finished, including errored connections', () => {
  assert.equal(emptyFeedState({ ...base, connections: [synced] }), 'connected')
  assert.equal(emptyFeedState({ ...base, connections: [{ status: 'error', last_synced_at: null }] }), 'connected')
})

test('strava flag messages', () => {
  assert.equal(stravaFlagMessage('connected').isError, false)
  assert.equal(stravaFlagMessage('denied').isError, true)
  assert.equal(stravaFlagMessage('bogus').isError, true)
})

test('strava state carries the dashboard return target', () => {
  const secret = 's'
  const home = verifyState({ state: signState({ userId: 'u', secret, returnTo: 'home' }), secret })
  assert.equal(stravaReturnPath(home.returnTo), '/')
  const plain = verifyState({ state: signState({ userId: 'u', secret }), secret })
  assert.deepEqual(plain, { ok: true, userId: 'u' })
  assert.equal(stravaReturnPath(plain.returnTo), '/settings')
})
