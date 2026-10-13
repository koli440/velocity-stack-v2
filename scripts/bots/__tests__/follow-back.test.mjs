import test from 'node:test'
import assert from 'node:assert/strict'
import { followBack } from '../lib.mjs'

function fakeClient({ follows, blocks = [] }) {
  const upserts = []
  const result = (data) => ({ data, error: null })
  return {
    upserts,
    from(table) {
      return {
        select: () => ({
          in: async () => result(follows),
          or: async () => result(blocks),
        }),
        upsert: async (rows) => {
          upserts.push(...rows)
          return { error: null }
        },
      }
    },
  }
}

const bots = [{ id: 'bot1' }, { id: 'bot2' }]

test('bots follow back real followers only', async () => {
  const sb = fakeClient({
    follows: [
      { follower_id: 'u1', followee_id: 'bot1' },
      { follower_id: 'bot2', followee_id: 'bot1' },
    ],
  })
  assert.equal(await followBack(sb, bots), 1)
  assert.deepEqual(sb.upserts, [{ follower_id: 'bot1', followee_id: 'u1' }])
})

test('follow-back skips blocked riders', async () => {
  const sb = fakeClient({
    follows: [{ follower_id: 'u1', followee_id: 'bot1' }, { follower_id: 'u2', followee_id: 'bot1' }],
    blocks: [{ blocker_id: 'u2', blocked_id: 'bot1' }],
  })
  assert.equal(await followBack(sb, bots), 1)
  assert.deepEqual(sb.upserts, [{ follower_id: 'bot1', followee_id: 'u1' }])
})

test('nothing to do when no real followers', async () => {
  const sb = fakeClient({ follows: [] })
  assert.equal(await followBack(sb, bots), 0)
  assert.equal(sb.upserts.length, 0)
})
