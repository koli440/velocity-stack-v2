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
