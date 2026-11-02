import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeGarminWebhook } from '../garmin.js'

test('garmin webhook auth: path token, legacy query token, rejections logged without secrets', () => {
  const warns = []
  const warn = (m) => warns.push(m)
  const expected = 'sekret-value'
  assert.equal(authorizeGarminWebhook({ pathToken: 'bad', expected, warn }).status, 403)
  assert.equal(authorizeGarminWebhook({ expected, warn }).status, 403)
  assert.equal(authorizeGarminWebhook({ queryToken: 'nope', expected, warn }).status, 403)
  assert.equal(warns.length, 3)
  assert.ok(warns.every((w) => !w.includes(expected) && !w.includes('nope') && !w.includes('bad')))
  assert.equal(authorizeGarminWebhook({ pathToken: expected, expected, warn }).ok, true)
  assert.equal(authorizeGarminWebhook({ queryToken: expected, expected, warn }).ok, true)
  assert.equal(authorizeGarminWebhook({ pathToken: 'a', expected: '', warn }).status, 503)
})
