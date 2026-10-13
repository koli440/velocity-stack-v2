import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeSearchTerm,
  isValidVisibility,
  followUser,
  unfollowUser,
  searchRiders,
  fetchFollowingFeedPage,
  setActivityVisibility,
  authorName,
  blockUser,
  unblockUser,
  fetchBlockedIds,
  fetchFollowCounts,
  approveFollowRequest,
  removeFollowRequest,
  fetchDiscoverFeedPage,
  setRequireFollowApproval,
  VISIBILITY_OPTIONS,
  DEFAULT_VISIBILITY,
} from '../social.js'

// Minimal chainable fake: records calls, resolves per-table results.
function fakeClient(results) {
  const log = []
  return {
    log,
    from(table) {
      const call = { table, ops: [] }
      log.push(call)
      const builder = new Proxy(
        {},
        {
          get(_, op) {
            if (op === 'then') {
              const r = results[table] ?? { data: [], error: null }
              return (resolve) => resolve(typeof r === 'function' ? r(call) : r)
            }
            return (...args) => {
              call.ops.push([op, ...args])
              return builder
            }
          },
        }
      )
      return builder
    },
  }
}

test('sanitizeSearchTerm strips filter metacharacters and limits length', () => {
  assert.equal(sanitizeSearchTerm('  jo%hn,(x)_*  '), 'jo hn x')
  assert.equal(sanitizeSearchTerm(null), '')
  assert.equal(sanitizeSearchTerm('a'.repeat(100)).length, 50)
})

test('visibility validation', () => {
  assert.ok(isValidVisibility('followers'))
  assert.ok(!isValidVisibility('everyone'))
})

test('followUser rejects self-follow and treats duplicates as success', async () => {
  const c = fakeClient({})
  assert.ok((await followUser(c, { followerId: 'a', followeeId: 'a' })).error)
  assert.equal(c.log.length, 0)
  const dup = fakeClient({ follows: { error: { code: '23505' } } })
  assert.equal((await followUser(dup, { followerId: 'a', followeeId: 'b' })).error, null)
  const bad = fakeClient({ follows: { error: { code: '42501', message: 'x' } } })
  assert.ok((await followUser(bad, { followerId: 'a', followeeId: 'b' })).error)
})

test('unfollowUser deletes by both ids', async () => {
  const c = fakeClient({ follows: { error: null } })
  await unfollowUser(c, { followerId: 'a', followeeId: 'b' })
  assert.deepEqual(c.log[0].ops.filter((o) => o[0] === 'eq'), [
    ['eq', 'follower_id', 'a'],
    ['eq', 'followee_id', 'b'],
  ])
})

test('searchRiders ignores short terms and excludes self', async () => {
  const c = fakeClient({
    public_profiles: { data: [{ id: 'me' }, { id: 'r1' }, { id: 'r2' }], error: null },
  })
  assert.deepEqual((await searchRiders(c, { term: 'a' })).riders, [])
  assert.equal(c.log.length, 0)
  const res = await searchRiders(c, { term: 'ann', excludeId: 'me', limit: 1 })
  assert.deepEqual(res.riders.map((r) => r.id), ['r1'])
})

test('following feed returns empty without follows, otherwise attaches authors', async () => {
  const empty = fakeClient({ follows: { data: [], error: null } })
  assert.deepEqual(await fetchFollowingFeedPage(empty, { userId: 'me' }), { data: [], hasMore: false, error: null })

  const c = fakeClient({
    follows: { data: [{ followee_id: 'r1' }], error: null },
    activities: { data: [{ id: 'a1', user_id: 'r1' }], error: null },
    public_profiles: { data: [{ id: 'r1', full_name: 'Ann' }], error: null },
  })
  const res = await fetchFollowingFeedPage(c, { userId: 'me', pageSize: 1 })
  assert.equal(res.data[0].author.full_name, 'Ann')
  assert.equal(res.hasMore, true)
  const act = c.log.find((l) => l.table === 'activities')
  assert.ok(act.ops.some((o) => o[0] === 'in' && o[1] === 'user_id' && o[2][0] === 'r1'))
  assert.ok(act.ops.some((o) => o[0] === 'neq' && o[1] === 'visibility' && o[2] === 'private'))
})

test('setActivityVisibility validates input', async () => {
  const c = fakeClient({ activities: { error: null } })
  assert.ok((await setActivityVisibility(c, { activityId: 'a', visibility: 'nope' })).error)
  assert.equal((await setActivityVisibility(c, { activityId: 'a', visibility: 'public' })).error, null)
})

test('authorName falls back gracefully', () => {
  assert.equal(authorName({ full_name: 'Ann', username: 'a' }), 'Ann')
  assert.equal(authorName({ username: 'a' }), 'a')
  assert.equal(authorName(null), 'Rider')
})

test('public is the default visibility and is clearly labelled', () => {
  assert.equal(DEFAULT_VISIBILITY, 'public')
  const pub = VISIBILITY_OPTIONS.find((o) => o.value === 'public')
  assert.match(pub.hint, /Any signed-in VelocityStack rider/)
  assert.match(pub.hint, /blocked/)
  assert.ok(VISIBILITY_OPTIONS.every((o) => o.hint))
})

test('followUser creates a request when the target requires approval', async () => {
  const c = fakeClient({ follow_requests: { error: null } })
  const res = await followUser(c, { followerId: 'a', followeeId: 'b', requiresApproval: true })
  assert.deepEqual(res, { error: null, status: 'requested' })
  assert.equal(c.log[0].table, 'follow_requests')
  assert.deepEqual(c.log[0].ops[0], ['insert', { requester_id: 'a', target_id: 'b' }])

  const direct = fakeClient({ follows: { error: null } })
  assert.equal((await followUser(direct, { followerId: 'a', followeeId: 'b' })).status, 'following')

  const blockedByRls = fakeClient({ follows: { error: { code: '42501', message: 'denied' } } })
  const denied = await followUser(blockedByRls, { followerId: 'a', followeeId: 'b' })
  assert.ok(denied.error)
  assert.equal(denied.status, null)
})

test('searchRiders also excludes blocked riders', async () => {
  const c = fakeClient({ public_profiles: { data: [{ id: 'x' }, { id: 'r1' }], error: null } })
  const res = await searchRiders(c, { term: 'ann', excludeId: 'me', excludeIds: ['x'] })
  assert.deepEqual(res.riders.map((r) => r.id), ['r1'])
})

test('blockUser validates, inserts and tolerates duplicates; unblock deletes by both ids', async () => {
  const c = fakeClient({})
  assert.ok((await blockUser(c, { blockerId: 'a', blockedId: 'a' })).error)
  assert.equal(c.log.length, 0)

  const ok = fakeClient({ blocks: { error: null } })
  assert.equal((await blockUser(ok, { blockerId: 'a', blockedId: 'b' })).error, null)
  assert.deepEqual(ok.log[0].ops[0], ['insert', { blocker_id: 'a', blocked_id: 'b' }])

  const dup = fakeClient({ blocks: { error: { code: '23505' } } })
  assert.equal((await blockUser(dup, { blockerId: 'a', blockedId: 'b' })).error, null)

  const un = fakeClient({ blocks: { error: null } })
  await unblockUser(un, { blockerId: 'a', blockedId: 'b' })
  assert.deepEqual(un.log[0].ops.filter((o) => o[0] === 'eq'), [
    ['eq', 'blocker_id', 'a'],
    ['eq', 'blocked_id', 'b'],
  ])
})

test('fetchBlockedIds maps rows', async () => {
  const c = fakeClient({ blocks: { data: [{ blocked_id: 'x' }, { blocked_id: 'y' }], error: null } })
  assert.deepEqual((await fetchBlockedIds(c, 'me')).ids, ['x', 'y'])
  assert.deepEqual((await fetchBlockedIds(c, null)).ids, [])
})

test('fetchFollowCounts reads both directions', async () => {
  const c = fakeClient({
    follows: (call) => ({
      count: call.ops.some((o) => o[0] === 'eq' && o[1] === 'followee_id') ? 3 : 5,
      error: null,
    }),
  })
  const res = await fetchFollowCounts(c, 'me')
  assert.deepEqual(res, { followers: 3, following: 5, error: null })
  assert.deepEqual(await fetchFollowCounts(c, null), { followers: 0, following: 0, error: null })
})

test('approve uses the RPC; decline/cancel delete the request', async () => {
  const calls = []
  const rpcClient = { rpc: async (n, a) => (calls.push([n, a]), { error: null }) }
  assert.equal((await approveFollowRequest(rpcClient, { requesterId: 'r' })).error, null)
  assert.deepEqual(calls[0], ['approve_follow_request', { p_requester: 'r' }])

  const c = fakeClient({ follow_requests: { error: null } })
  await removeFollowRequest(c, { requesterId: 'r', targetId: 't' })
  assert.deepEqual(c.log[0].ops.filter((o) => o[0] === 'eq'), [
    ['eq', 'requester_id', 'r'],
    ['eq', 'target_id', 't'],
  ])
})

test('setRequireFollowApproval coerces to boolean', async () => {
  const c = fakeClient({ profiles: { error: null } })
  await setRequireFollowApproval(c, { userId: 'u', value: 1 })
  assert.deepEqual(c.log[0].ops[0], ['update', { require_follow_approval: true }])
})

test('discover feed requests public rows from others, excludes blocked, attaches authors', async () => {
  const c = fakeClient({
    activities: { data: [{ id: 'a1', user_id: 'u1' }], error: null },
    public_profiles: { data: [{ id: 'u1', username: 'ann' }], error: null },
  })
  const res = await fetchDiscoverFeedPage(c, { userId: 'me', excludeIds: ['b1', 'b2'], pageSize: 1 })
  const ops = c.log[0].ops
  assert.ok(ops.some((o) => o[0] === 'eq' && o[1] === 'visibility' && o[2] === 'public'))
  assert.ok(ops.some((o) => o[0] === 'neq' && o[1] === 'user_id' && o[2] === 'me'))
  assert.ok(ops.some((o) => o[0] === 'not' && o[1] === 'user_id' && o[3] === '(b1,b2)'))
  assert.equal(res.hasMore, true)
  assert.equal(res.data[0].author.username, 'ann')
  assert.deepEqual((await fetchDiscoverFeedPage(c, { userId: null })).data, [])
})
