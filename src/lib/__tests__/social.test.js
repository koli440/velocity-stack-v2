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
  fetchPrivacyZone,
  savePrivacyZone,
} from '../social.js'

// Minimal chainable fake: records calls, resolves per-table results.
function fakeClient(results) {
  const log = []
  return {
    log,
    rpc(name, args) {
      log.push({ rpc: name, args })
      return Promise.resolve(results[name] ?? { data: [], error: null })
    },
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
  assert.equal(sanitizeSearchTerm('a'.repeat(300)).length, 254)
  assert.equal(sanitizeSearchTerm(' Ann.Lee@Example.com '), 'Ann.Lee@Example.com')
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
    search_riders: { data: [{ id: 'me' }, { id: 'r1' }, { id: 'r2' }], error: null },
  })
  assert.deepEqual((await searchRiders(c, { term: 'a' })).riders, [])
  assert.equal(c.log.length, 0)
  const res = await searchRiders(c, { term: 'ann', excludeId: 'me', limit: 1 })
  assert.equal(c.log[0].rpc, 'search_riders')
  assert.equal(c.log[0].args.p_term, 'ann')
  assert.deepEqual(res.riders.map((r) => r.id), ['r1'])
})

test('following feed returns empty without follows, otherwise attaches authors', async () => {
  const empty = fakeClient({ follows: { data: [], error: null } })
  assert.deepEqual(await fetchFollowingFeedPage(empty, { userId: 'me' }), { data: [], hasMore: false, error: null })

  const c = fakeClient({
    follows: { data: [{ followee_id: 'r1' }], error: null },
    shared_activities: { data: [{ id: 'a1', user_id: 'r1' }], error: null },
    public_profiles: { data: [{ id: 'r1', display_name: 'Ann' }], error: null },
  })
  const res = await fetchFollowingFeedPage(c, { userId: 'me', pageSize: 1 })
  assert.equal(res.data[0].author.display_name, 'Ann')
  assert.equal(res.hasMore, true)
  const act = c.log.find((l) => l.table === 'shared_activities')
  assert.ok(act.ops.some((o) => o[0] === 'in' && o[1] === 'user_id' && o[2][0] === 'r1'))
  assert.ok(act.ops.some((o) => o[0] === 'neq' && o[1] === 'visibility' && o[2] === 'private'))
})

test('setActivityVisibility validates input', async () => {
  const c = fakeClient({ activities: { error: null } })
  assert.ok((await setActivityVisibility(c, { activityId: 'a', visibility: 'nope' })).error)
  assert.equal((await setActivityVisibility(c, { activityId: 'a', visibility: 'public' })).error, null)
})

test('authorName falls back gracefully', () => {
  assert.equal(authorName({ display_name: 'Ann' }), 'Ann')
  assert.equal(authorName({ nickname: 'x' }), 'Rider')
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
  const c = fakeClient({ search_riders: { data: [{ id: 'x' }, { id: 'r1' }], error: null } })
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
    shared_activities: { data: [{ id: 'a1', user_id: 'u1' }], error: null },
    public_profiles: { data: [{ id: 'u1', display_name: 'ann' }], error: null },
  })
  const res = await fetchDiscoverFeedPage(c, { userId: 'me', excludeIds: ['b1', 'b2'], pageSize: 1 })
  const ops = c.log[0].ops
  assert.ok(ops.some((o) => o[0] === 'eq' && o[1] === 'visibility' && o[2] === 'public'))
  assert.ok(ops.some((o) => o[0] === 'neq' && o[1] === 'user_id' && o[2] === 'me'))
  assert.ok(ops.some((o) => o[0] === 'not' && o[1] === 'user_id' && o[3] === '(b1,b2)'))
  assert.equal(res.hasMore, true)
  assert.equal(res.data[0].author.display_name, 'ann')
  assert.deepEqual((await fetchDiscoverFeedPage(c, { userId: null })).data, [])
})

test('other riders\' feeds read the restricted shared_activities view, never activities', async () => {
  const c = fakeClient({
    follows: { data: [{ followee_id: 'r1' }], error: null },
    shared_activities: { data: [], error: null },
  })
  await fetchFollowingFeedPage(c, { userId: 'me' })
  await fetchDiscoverFeedPage(c, { userId: 'me' })
  const tables = c.log.map((l) => l.table)
  assert.ok(!tables.includes('activities'))
  assert.equal(tables.filter((x) => x === 'shared_activities').length, 2)
  for (const call of c.log.filter((l) => l.table === 'shared_activities')) {
    const cols = call.ops.find((o) => o[0] === 'select')[1]
    assert.ok(!cols.includes('raw_file_url'))
    assert.ok(!cols.includes('time_series'))
  }
})

test('fetchPrivacyZone normalises columns; disabled when unset', async () => {
  const c = fakeClient({ profiles: { data: null, error: null } })
  // maybeSingle resolves through the same thenable
  assert.equal((await fetchPrivacyZone(c, 'u')).zone, null)
  const set = fakeClient({ profiles: { data: { privacy_zone_lat: '50.08170', privacy_zone_lng: '14.48420', privacy_zone_radius_m: 250 }, error: null } })
  assert.deepEqual((await fetchPrivacyZone(set, 'u')).zone, { lat: 50.0817, lng: 14.4842, radius: 250 })
  assert.equal((await fetchPrivacyZone(set, null)).zone, null)
})

test('savePrivacyZone validates, rounds and can disable', async () => {
  const bad = fakeClient({})
  assert.ok((await savePrivacyZone(bad, { userId: 'u', zone: { lat: 95, lng: 0, radius: 200 } })).error)
  assert.ok((await savePrivacyZone(bad, { userId: 'u', zone: { lat: 1, lng: 1, radius: 10 } })).error)
  assert.equal(bad.log.length, 0)

  const ok = fakeClient({ profiles: { error: null } })
  const res = await savePrivacyZone(ok, { userId: 'u', zone: { lat: '50.123456', lng: '14.1', radius: '200' } })
  assert.deepEqual(res.zone, { lat: 50.12346, lng: 14.1, radius: 200 })
  assert.deepEqual(ok.log[0].ops[0], ['update', { privacy_zone_lat: 50.12346, privacy_zone_lng: 14.1, privacy_zone_radius_m: 200 }])

  const off = fakeClient({ profiles: { error: null } })
  const disabled = await savePrivacyZone(off, { userId: 'u', zone: null })
  assert.equal(disabled.zone, null)
  assert.deepEqual(off.log[0].ops[0], ['update', { privacy_zone_lat: null, privacy_zone_lng: null, privacy_zone_radius_m: null }])
})
