// Cookie consent (GDPR/ePrivacy): pure helpers, no DOM. UI is in components/ConsentManager.js, see docs/analytics.md.
export const CONSENT_KEY = 'vs.consent'
// Bump when categories or the vendors inside them change: everyone is asked again.
export const CONSENT_VERSION = 1
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
export const OPEN_SETTINGS_EVENT = 'vs:open-cookie-settings'

export const CONSENT_CATEGORIES = ['analytics', 'marketing']

/** Google Consent Mode v2 defaults: everything denied until the visitor chooses. */
export const GOOGLE_CONSENT_DENIED = {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
}

/** @returns {{version:number, ts:number, analytics:boolean, marketing:boolean}} */
export function buildConsentRecord(choice, now = Date.now()) {
  return {
    version: CONSENT_VERSION,
    ts: now,
    analytics: choice?.analytics === true,
    marketing: choice?.marketing === true,
  }
}

/** Parses a stored value; returns a valid, current, unexpired record or null (ask again). */
export function parseConsent(raw, now = Date.now()) {
  let rec
  try {
    rec = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (!rec || typeof rec !== 'object') return null
  if (rec.version !== CONSENT_VERSION) return null
  if (typeof rec.ts !== 'number' || !Number.isFinite(rec.ts)) return null
  if (rec.ts > now + 60 * 1000) return null
  if (now - rec.ts > CONSENT_MAX_AGE_MS) return null
  if (typeof rec.analytics !== 'boolean' || typeof rec.marketing !== 'boolean') return null
  return { version: rec.version, ts: rec.ts, analytics: rec.analytics, marketing: rec.marketing }
}

export function readConsent(storage, now = Date.now()) {
  try {
    return parseConsent(storage?.getItem(CONSENT_KEY), now)
  } catch {
    return null
  }
}

export function writeConsent(storage, record) {
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

/** True only when a valid stored choice grants the category. */
export function hasConsent(category, storage, now = Date.now()) {
  const rec = readConsent(storage, now)
  return !!rec && rec[category] === true
}

/** Maps our categories to Google Consent Mode v2 signals. */
export function googleConsentState(record) {
  const analytics = record?.analytics === true
  const marketing = record?.marketing === true
  return {
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: marketing ? 'granted' : 'denied',
    ad_user_data: marketing ? 'granted' : 'denied',
    ad_personalization: marketing ? 'granted' : 'denied',
  }
}

/** Which scripts may load for a record (null = no choice yet = none). */
export function allowedScripts(record) {
  return { ga: record?.analytics === true, reddit: record?.marketing === true }
}

/** True when something that was allowed is now withdrawn (loaded scripts need a reload to stop). */
export function needsReload(prev, next) {
  const was = allowedScripts(prev)
  const now = allowedScripts(next)
  return (was.ga && !now.ga) || (was.reddit && !now.reddit)
}

/** Names of cookies set by our third-party tags, for deletion when consent is withdrawn. */
export function thirdPartyCookieNames(allNames) {
  return allNames.filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid' || n.startsWith('_gat') || n === '_gcl_au' || n.startsWith('_rdt_') || n === '_rdt_uuid')
}
