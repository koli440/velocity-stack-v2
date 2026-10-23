import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath, nextOrDefault, oauthRedirectTo, oauthErrorMessage, parseOAuthError } from '../authRedirect.js'
import { profileFromAuthMetadata, signInMethods } from '../oauthProfile.js'

test('safeNextPath accepts same-origin paths only', () => {
  assert.equal(safeNextPath('/calendar?month=2027-01'), '/calendar?month=2027-01')
  assert.equal(safeNextPath('/activities/1'), '/activities/1')
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', 'calendar', '', null, 7, '/a\nb', '/login', '/register', '/auth/callback?next=/', '/'.padEnd(600, 'a')]) {
    assert.equal(safeNextPath(bad), null, String(bad))
  }
})

test('nextOrDefault falls back to the dashboard', () => {
  assert.equal(nextOrDefault('//evil.com'), '/')
  assert.equal(nextOrDefault(undefined), '/')
  assert.equal(nextOrDefault('/fitness'), '/fitness')
})

test('oauthRedirectTo builds the callback url', () => {
  assert.equal(oauthRedirectTo('https://x.app', '/fitness?a=1'), 'https://x.app/auth/callback?next=%2Ffitness%3Fa%3D1')
  assert.equal(oauthRedirectTo('https://x.app', '//evil.com'), 'https://x.app/auth/callback')
  assert.equal(oauthRedirectTo('https://x.app', '/'), 'https://x.app/auth/callback')
})

test('oauth errors are friendly and parsed from query or fragment', () => {
  assert.match(oauthErrorMessage('access_denied'), /cancelled/)
  assert.match(oauthErrorMessage('server_error', 'boom'), /failed/)
  assert.deepEqual(parseOAuthError('?x=1', '#error=access_denied&error_description=No'), { error: 'access_denied', description: 'No' })
  assert.equal(parseOAuthError('?code=abc', '#access_token=t'), null)
})

test('profileFromAuthMetadata: email signup, google, fallbacks', () => {
  assert.deepEqual(profileFromAuthMetadata({ first_name: ' Ann ', last_name: 'Lee' }, 'a@b.c'), { first_name: 'Ann', last_name: 'Lee', nickname: null })
  assert.deepEqual(profileFromAuthMetadata({ full_name: 'Ann Marie Lee', name: 'x' }, 'a@b.c'), { first_name: 'Ann', last_name: 'Marie Lee', nickname: null })
  assert.deepEqual(profileFromAuthMetadata({ given_name: 'Ann', family_name: 'Lee', full_name: 'Zed' }, 'a@b.c'), { first_name: 'Ann', last_name: 'Lee', nickname: null })
  assert.deepEqual(profileFromAuthMetadata({ name: 'Cher' }, 'c@b.c'), { first_name: 'Cher', last_name: null, nickname: null })
  assert.deepEqual(profileFromAuthMetadata({}, 'rider.one@x.io'), { first_name: null, last_name: null, nickname: 'rider.one' })
  assert.deepEqual(profileFromAuthMetadata(null, ''), { first_name: null, last_name: null, nickname: null })
})

test('signInMethods lists providers', () => {
  assert.deepEqual(signInMethods({ identities: [{ provider: 'email' }, { provider: 'google' }] }).sort(), ['email', 'google'])
  assert.deepEqual(signInMethods({ app_metadata: { provider: 'google' } }), ['google'])
  assert.deepEqual(signInMethods(null), [])
})
