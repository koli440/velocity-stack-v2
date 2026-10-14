import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeRiderTerm,
  followButtonLabel,
  formatLastActive,
  formatRideCount,
  mergeRiderPages,
  fetchRidersPage,
  fetchRiderProfile,
  riderName,
} from '../riders.js'

test('normalizeRiderTerm enforces the minimum length and trims', () => {
  assert.equal(normalizeRiderTerm('a'), '')
  assert.equal(normalizeRiderTerm('  ab  '), 'ab')
  assert.equal(normalizeRiderTerm(null), '')
  assert.equal(normalizeRiderTerm('x'.repeat(80)).length, 50)
})

test('followButtonLabel covers every state', () => {
  assert.equal(followButtonLabel({ follow_status: 'following' }), 'Unfollow')
  assert.equal(followButtonLabel({ follow_status: 'requested' }), 'Requested')
  assert.equal(followButtonLabel({ follow_status: 'none', require_follow_approval: true }), 'Request')
  assert.equal(followButtonLabel({ follow_status: 'none' }), 'Follow')
  assert.equal(followButtonLabel({ follow_status: 'self' }), null)
})

test('formatLastActive', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  assert.equal(formatLastActive(null, now), 'No public rides yet')
  assert.equal(formatLastActive('2026-10-14', now), 'Rode today')
  assert.equal(formatLastActive('2026-10-13', now), 'Rode yesterday')
  assert.equal(formatLastActive('2026-10-09', now), 'Rode 5 days ago')
  assert.equal(formatLastActive('2026-06-01', now), 'Last ride 2026-06-01')
})

test('formatRideCount and riderName', () => {
  assert.equal(formatRideCount(1), '1 public ride')
  assert.equal(formatRideCount(0), '0 public rides')
  assert.equal(riderName({ username: 'bob' }), 'bob')
  assert.equal(riderName(null), 'Rider')
})

test('mergeRiderPages drops duplicates', () => {
  const merged = mergeRiderPages([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])
  assert.deepEqual(merged.map((r) => r.id), [1, 2, 3])
})

test('fetchRidersPage requests limit+1 and reports hasMore', async () => {
  let args
  const client = {
    rpc: async (name, a) => {
      args = { name, ...a }
      return { data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null }
    },
  }
  const res = await fetchRidersPage(client, { term: 'a', botsOnly: true, offset: 4, limit: 2 })
  assert.equal(args.name, 'search_riders')
  assert.deepEqual(
    { t: args.p_term, b: args.p_bots_only, l: args.p_limit, o: args.p_offset },
    { t: '', b: true, l: 3, o: 4 }
  )
  assert.equal(res.riders.length, 2)
  assert.equal(res.hasMore, true)
})

test('fetchRidersPage and fetchRiderProfile surface errors / empty rows', async () => {
  const bad = { rpc: async () => ({ data: null, error: new Error('boom') }) }
  assert.equal((await fetchRidersPage(bad)).error.message, 'boom')
  const none = { rpc: async () => ({ data: [], error: null }) }
  assert.equal((await fetchRiderProfile(none, 'x')).rider, null)
  const one = { rpc: async () => ({ data: [{ id: 'x' }], error: null }) }
  assert.equal((await fetchRiderProfile(one, 'x')).rider.id, 'x')
})
