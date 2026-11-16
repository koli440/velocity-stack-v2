import test from 'node:test'
import assert from 'node:assert/strict'
import { canEditMessage, chatErrorMessage, mergeMessages, totalUnread, EDIT_WINDOW_MS } from '../coachChat.js'
import { describeNotification, notificationHref } from '../notifications.js'

test('canEditMessage: own, not deleted, within window', () => {
  const now = Date.now()
  const m = { sender_id: 'a', created_at: new Date(now - 1000).toISOString() }
  assert.equal(canEditMessage(m, 'a', now), true)
  assert.equal(canEditMessage(m, 'b', now), false)
  assert.equal(canEditMessage({ ...m, deleted: true }, 'a', now), false)
  assert.equal(canEditMessage({ ...m, created_at: new Date(now - EDIT_WINDOW_MS - 1).toISOString() }, 'a', now), false)
})

test('mergeMessages sorts oldest first and de-duplicates by id', () => {
  const out = mergeMessages([{ id: '2', created_at: '2026-01-02', body: 'new' }], [{ id: '1', created_at: '2026-01-01' }, { id: '2', created_at: '2026-01-02', body: 'edited' }])
  assert.deepEqual(out.map((m) => m.id), ['1', '2'])
  assert.equal(out[1].body, 'edited')
})

test('totalUnread and error mapping', () => {
  assert.equal(totalUnread([{ unread: 2 }, { unread: '3' }, {}]), 5)
  assert.equal(totalUnread(null), 0)
  assert.match(chatErrorMessage({ message: 'Chat is read-only' }), /read-only/)
  assert.match(chatErrorMessage({ message: 'Too many messages, try again later' }), /too fast/)
})

test('coach_message notification has no message text and links to /chat', () => {
  const n = { type: 'coach_message', actor_nickname: 'Sam' }
  assert.match(describeNotification(n), /sent you a message/)
  assert.equal(notificationHref(n), '/chat')
})
