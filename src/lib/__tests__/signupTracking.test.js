import test from 'node:test'
import assert from 'node:assert/strict'
import { CONSENT_KEY, buildConsentRecord } from '../consent.js'
import {
  parseAttribution, isNewGoogleUser, trackSignUp, rememberOAuthStart, trackOAuthSignUpOnce, OAUTH_PENDING_KEY,
} from '../signupTracking.js'

const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
const newUser = (over = {}) => ({
  id: 'u1', app_metadata: { provider: 'google' },
  created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), ...over,
})

const granted = (c = { analytics: true, marketing: true }) => {
  const m = mem()
  m.setItem(CONSENT_KEY, JSON.stringify(buildConsentRecord(c)))
  return m
}

test.afterEach(() => { delete globalThis.window })

test('parseAttribution keeps only utm_source/medium/campaign and gclid', () => {
  assert.deepEqual(parseAttribution('?utm_source=g&utm_medium=cpc&utm_campaign=c&gclid=x&next=/a&utm_term=t'),
    { utm_source: 'g', utm_medium: 'cpc', utm_campaign: 'c', gclid: 'x' })
  assert.deepEqual(parseAttribution(''), {})
})

test('isNewGoogleUser distinguishes fresh accounts from returning ones', () => {
  assert.equal(isNewGoogleUser(newUser()), true)
  assert.equal(isNewGoogleUser(newUser({ created_at: '2020-01-01T00:00:00Z' })), false)
  assert.equal(isNewGoogleUser(newUser({ app_metadata: { provider: 'email' } })), false)
  assert.equal(isNewGoogleUser(null), false)
})

test('trackSignUp sends GA4 sign_up and Reddit SignUp, and is a no-op without them', () => {
  assert.doesNotThrow(() => trackSignUp('email'))
  const calls = []
  globalThis.window = { localStorage: granted(), gtag: (...a) => calls.push(['gtag', ...a]), rdt: (...a) => calls.push(['rdt', ...a]) }
  trackSignUp('google', { utm_source: 's', utm_campaign: 'c' })
  assert.deepEqual(calls[0], ['gtag', 'event', 'sign_up', { method: 'google', campaign_source: 's', campaign: 'c' }])
  assert.deepEqual(calls[1], ['rdt', 'track', 'SignUp'])
})

test('trackSignUp fires nothing without consent and only the granted category otherwise', () => {
  const calls = []
  const mk = (localStorage) => ({ localStorage, gtag: (...a) => calls.push(a[1]), rdt: (...a) => calls.push(a[2]) })
  globalThis.window = mk(mem())
  trackSignUp('email')
  globalThis.window = mk(granted({ analytics: false, marketing: false }))
  trackSignUp('email')
  assert.deepEqual(calls, [])
  globalThis.window = mk(granted({ analytics: true, marketing: false }))
  trackSignUp('email')
  assert.deepEqual(calls, ['sign_up'])
  calls.length = 0
  globalThis.window = mk(granted({ analytics: false, marketing: true }))
  trackSignUp('email')
  assert.deepEqual(calls, ['SignUp'])
})

test('Google sign-up fires once, only after our OAuth start and for a new user', () => {
  const calls = []
  globalThis.window = {
    sessionStorage: mem(), localStorage: granted(),
    gtag: (...a) => calls.push(a), rdt: (...a) => calls.push(a),
  }
  assert.equal(trackOAuthSignUpOnce(newUser()), false)
  rememberOAuthStart('?utm_source=g&gclid=1')
  assert.equal(window.sessionStorage.getItem(OAUTH_PENDING_KEY), '1')
  assert.equal(trackOAuthSignUpOnce(newUser()), true)
  assert.equal(calls.length, 2)
  rememberOAuthStart('')
  assert.equal(trackOAuthSignUpOnce(newUser()), false)
  rememberOAuthStart('')
  assert.equal(trackOAuthSignUpOnce(newUser({ created_at: '2020-01-01T00:00:00Z' })), false)
  assert.equal(calls.length, 2)
})
