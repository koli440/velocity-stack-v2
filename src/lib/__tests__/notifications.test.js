import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeNotification,
  countUnread,
  fetchNotifications,
  markAllNotificationsRead,
} from '../notifications.js'

function fakeClient(results) {
  const log = []
  return {
    log,
    from(table) {
      const call = { table, ops: [] }
      log.push(call)
      const b = new Proxy({}, {
        get(_, op) {
          if (op === 'then') return (resolve) => resolve(results[table] ?? { data: [], error: null })
          return (...args) => (call.ops.push([op, ...args]), b)
        },
      })
      return b
    },
  }
}

test('describeNotification covers each type and missing actors', () => {
  const actor = { username: 'ann' }
  assert.equal(describeNotification({ type: 'new_follower' }, actor), 'ann started following you')
  assert.equal(describeNotification({ type: 'follow_request' }, actor), 'ann wants to follow you')
  assert.equal(describeNotification({ type: 'follow_approved' }, null), 'A rider approved your follow request')
  assert.equal(describeNotification({ type: 'other' }, actor), 'New notification')
})

test('countUnread counts rows without read_at', () => {
  assert.equal(countUnread([{ read_at: null }, { read_at: 'x' }, {}]), 2)
  assert.equal(countUnread(null), 0)
})

test('fetchNotifications attaches actors and scopes to the user', async () => {
  const c = fakeClient({
    notifications: { data: [{ id: 'n1', type: 'new_follower', actor_id: 'a1' }, { id: 'n2', type: 'new_follower', actor_id: 'gone' }], error: null },
    public_profiles: { data: [{ id: 'a1', username: 'ann' }], error: null },
  })
  const { notifications } = await fetchNotifications(c, 'me')
  assert.equal(notifications[0].actor.username, 'ann')
  assert.equal(notifications[1].actor, null)
  assert.ok(c.log[0].ops.some((o) => o[0] === 'eq' && o[1] === 'user_id' && o[2] === 'me'))
  assert.deepEqual((await fetchNotifications(c, null)).notifications, [])
})

test('markAllNotificationsRead only touches unread rows', async () => {
  const c = fakeClient({ notifications: { error: null } })
  assert.equal((await markAllNotificationsRead(c, 'me')).error, null)
  const ops = c.log[0].ops
  assert.ok(ops.some((o) => o[0] === 'is' && o[1] === 'read_at' && o[2] === null))
})
