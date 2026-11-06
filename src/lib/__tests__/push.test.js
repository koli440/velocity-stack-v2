import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPushPayload, safePushUrl, validateSubscription, isPushStale, deviceLabel, pushSupportState, urlBase64ToBytes, PUSH_MAX_AGE_MS,
} from '../push.js'

test('payload is short, generic title, bell text and deep link', () => {
  const p = buildPushPayload({ id: '1', type: 'new_follower', actor_id: 'a1' }, { display_name: 'Ann' })
  assert.equal(p.title, 'Velocity Stack')
  assert.equal(p.body, 'Ann started following you')
  assert.equal(p.url, '/riders/a1')
  assert.equal(p.tag, 'n-1')
})

test('payload falls back to / when there is no link and tolerates missing actor', () => {
  const p = buildPushPayload({ type: 'suggestion_approved' }, null)
  assert.equal(p.url, '/')
  assert.equal(p.body, 'Your suggestion was approved')
  assert.equal(buildPushPayload({ type: 'follow_request' }, { nickname: 'Bo' }).url, '/riders?tab=following#follow-requests')
})

test('safePushUrl only allows same-origin paths', () => {
  assert.equal(safePushUrl('/settings#coaching'), '/settings#coaching')
  for (const bad of ['https://evil.test', '//evil.test', 'javascript:1', null, undefined, '/a\\b']) assert.equal(safePushUrl(bad), '/')
})

test('validateSubscription accepts browser subscriptions and rejects bad ones', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'BNc_-abc', auth: 'a-b_c' } }
  assert.deepEqual(validateSubscription(good), { endpoint: good.endpoint, p256dh: 'BNc_-abc', auth: 'a-b_c' })
  assert.ok(validateSubscription({ toJSON: () => good }))
  assert.equal(validateSubscription({ ...good, endpoint: 'http://x' }), null)
  assert.equal(validateSubscription({ ...good, keys: { p256dh: 'x', auth: '' } }), null)
  assert.equal(validateSubscription({ ...good, keys: { p256dh: 'bad key!', auth: 'a' } }), null)
  assert.equal(validateSubscription(null), null)
})

test('stale notifications are not pushed', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')
  assert.equal(isPushStale('2026-11-06T11:59:00Z', now), false)
  assert.equal(isPushStale(new Date(now - PUSH_MAX_AGE_MS - 1000).toISOString(), now), true)
  assert.equal(isPushStale('garbage', now), true)
})

test('support state drives the settings toggle', () => {
  const base = { hasKey: true, hasPush: true, isIOS: false, standalone: false, permission: 'default' }
  assert.equal(pushSupportState({ ...base, hasKey: false }), 'hidden')
  assert.equal(pushSupportState({ ...base, isIOS: true }), 'ios-install')
  assert.equal(pushSupportState({ ...base, isIOS: true, standalone: true }), 'available')
  assert.equal(pushSupportState({ ...base, hasPush: false }), 'unsupported')
  assert.equal(pushSupportState({ ...base, permission: 'denied' }), 'blocked')
  assert.equal(pushSupportState(base), 'available')
})

test('deviceLabel and key decoding', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537'), 'Chrome on Android')
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10) Chrome/120 Safari/537 Edg/120'), 'Edge on Windows')
  assert.deepEqual([...urlBase64ToBytes('AQID')], [1, 2, 3])
  assert.deepEqual([...urlBase64ToBytes('-_8')], [251, 255])
})
