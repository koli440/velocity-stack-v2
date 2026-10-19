import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeNotification,
  countUnread,
  notificationHref,
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
  const actor = { display_name: 'ann' }
  assert.equal(describeNotification({ type: 'new_follower' }, actor), 'ann started following you')
  assert.equal(describeNotification({ type: 'follow_request' }, actor), 'ann wants to follow you')
  assert.equal(describeNotification({ type: 'follow_approved' }, null), 'A rider approved your follow request')
  assert.equal(describeNotification({ type: 'other' }, actor), 'New notification')
})

test('comment notifications are described and link into the right context', () => {
  const actor = { display_name: 'ann' }
  assert.equal(describeNotification({ type: 'activity_comment', activity_owned: true }, actor), 'ann commented on your activity')
  assert.equal(describeNotification({ type: 'activity_comment' }, actor), 'ann commented on an activity you follow')
  assert.equal(describeNotification({ type: 'comment_mention' }, actor), 'ann mentioned you in a comment')
  const own = { type: 'activity_comment', activity_id: 'a1', activity_info: { owner_id: 'me', viewer_is_coach: false } }
  assert.equal(notificationHref(own), '/activities/a1#comments')
  const coach = { type: 'comment_mention', activity_id: 'a1', activity_info: { owner_id: 'r1', viewer_is_coach: true } }
  assert.equal(notificationHref(coach), '/coach/r1/activities/a1#comments')
  assert.equal(notificationHref({ type: 'activity_comment', activity_id: 'a1', activity_info: null }), null)
})

test('fetchNotifications resolves comment activity info', async () => {
  const c = fakeClient({
    notifications: { data: [{ id: 'n1', type: 'activity_comment', actor_id: 'a1', activity_id: 'act1' }], error: null },
    public_profiles: { data: [{ id: 'a1', display_name: 'ann' }], error: null },
  })
  c.rpc = async () => ({ data: [{ activity_id: 'act1', owner_id: 'me', viewer_is_coach: false }], error: null })
  const { notifications } = await fetchNotifications(c, 'me')
  assert.equal(notifications[0].activity_owned, true)
  assert.equal(notificationHref(notifications[0]), '/activities/act1#comments')
})

test('countUnread counts rows without read_at', () => {
  assert.equal(countUnread([{ read_at: null }, { read_at: 'x' }, {}]), 2)
  assert.equal(countUnread(null), 0)
})

test('fetchNotifications attaches actors and scopes to the user', async () => {
  const c = fakeClient({
    notifications: { data: [{ id: 'n1', type: 'new_follower', actor_id: 'a1' }, { id: 'n2', type: 'new_follower', actor_id: 'gone' }], error: null },
    public_profiles: { data: [{ id: 'a1', display_name: 'ann' }], error: null },
  })
  const { notifications } = await fetchNotifications(c, 'me')
  assert.equal(notifications[0].actor.display_name, 'ann')
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

test('every notification type resolves to a sensible link (or none)', () => {
  const href = (n) => notificationHref(n)
  assert.equal(href({ type: 'follow_request', actor_id: 'a1' }), '/riders?tab=following#follow-requests')
  assert.equal(href({ type: 'new_follower', actor_id: 'a1' }), '/riders/a1')
  assert.equal(href({ type: 'follow_approved', actor_id: 'a1' }), '/riders/a1')
  assert.equal(href({ type: 'new_follower', actor_id: null }), null)
  for (const type of ['coach_invite', 'coach_request', 'coach_accepted', 'coach_ended', 'coach_replaced']) {
    assert.equal(href({ type }), '/settings#coaching', type)
  }
  assert.equal(href({ type: 'coach_edited' }), '/settings#physiology')
  assert.equal(href({ type: 'suggestion_submitted', suggestion_id: 's1' }), '/admin/suggestions/s1')
  assert.equal(href({ type: 'suggestion_submitted' }), null)
  assert.equal(href({ type: 'suggestion_approved', suggestion_id: 's1' }), null)
  assert.equal(href({ type: 'suggestion_rejected' }), null)
  assert.equal(href({ type: 'unknown' }), null)
  assert.equal(href(null), null)
})
