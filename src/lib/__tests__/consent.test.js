import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSENT_KEY, CONSENT_VERSION, CONSENT_MAX_AGE_MS, buildConsentRecord, parseConsent, readConsent, writeConsent,
  hasConsent, googleConsentState, allowedScripts, needsReload, thirdPartyCookieNames, GOOGLE_CONSENT_DENIED,
} from '../consent.js'

const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}
const NOW = Date.UTC(2026, 10, 4)

test('buildConsentRecord never pre-ticks optional categories', () => {
  const r = buildConsentRecord(undefined, NOW)
  assert.deepEqual(r, { version: CONSENT_VERSION, ts: NOW, analytics: false, marketing: false })
  assert.equal(buildConsentRecord({ analytics: 'yes' }, NOW).analytics, false)
})

test('parseConsent accepts a fresh record and rejects stale, future, versioned or malformed ones', () => {
  const ok = buildConsentRecord({ analytics: true }, NOW)
  assert.deepEqual(parseConsent(JSON.stringify(ok), NOW + 1000), ok)
  assert.equal(parseConsent(JSON.stringify(ok), NOW + CONSENT_MAX_AGE_MS + 1), null)
  assert.equal(parseConsent(JSON.stringify({ ...ok, version: CONSENT_VERSION + 1 }), NOW), null)
  assert.equal(parseConsent(JSON.stringify({ ...ok, ts: NOW + 10 * 60 * 1000 }), NOW), null)
  assert.equal(parseConsent(JSON.stringify({ ...ok, marketing: 'true' }), NOW), null)
  assert.equal(parseConsent('not json', NOW), null)
  assert.equal(parseConsent(null, NOW), null)
})

test('read/write/hasConsent round trip and fail closed', () => {
  const s = mem()
  assert.equal(hasConsent('analytics', s, NOW), false)
  assert.ok(writeConsent(s, buildConsentRecord({ analytics: true }, NOW)))
  assert.ok(s.getItem(CONSENT_KEY))
  assert.equal(hasConsent('analytics', s, NOW), true)
  assert.equal(hasConsent('marketing', s, NOW), false)
  assert.equal(hasConsent('analytics', s, NOW + CONSENT_MAX_AGE_MS + 1), false)
  assert.equal(readConsent(null, NOW), null)
  assert.equal(writeConsent({ setItem() { throw new Error('quota') } }, {}), false)
})

test('googleConsentState maps categories to Consent Mode v2 signals', () => {
  assert.deepEqual(googleConsentState(null), GOOGLE_CONSENT_DENIED)
  assert.deepEqual(googleConsentState({ analytics: true, marketing: false }), { ...GOOGLE_CONSENT_DENIED, analytics_storage: 'granted' })
  assert.deepEqual(googleConsentState({ analytics: false, marketing: true }), {
    analytics_storage: 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted',
  })
})

test('allowedScripts and needsReload', () => {
  assert.deepEqual(allowedScripts(null), { ga: false, reddit: false })
  const all = { analytics: true, marketing: true }
  assert.deepEqual(allowedScripts(all), { ga: true, reddit: true })
  assert.equal(needsReload(null, all), false)
  assert.equal(needsReload(all, { analytics: true, marketing: false }), true)
  assert.equal(needsReload({ analytics: true, marketing: false }, all), false)
})

test('thirdPartyCookieNames picks only analytics/ads cookies', () => {
  assert.deepEqual(thirdPartyCookieNames(['_ga', '_ga_ABC', '_rdt_uuid', 'theme', 'sb-x-auth-token', '_gcl_au']), ['_ga', '_ga_ABC', '_rdt_uuid', '_gcl_au'])
})
