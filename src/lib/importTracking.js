// GA4 events for the import landing pages. Sent only when the visitor granted the analytics category
// (src/lib/consent.js) and gtag is loaded; otherwise a no-op. See docs/analytics.md.
import { hasConsent } from './consent.js'
import { importEventParams } from './importGuides.js'

/** Returns true when an event was sent. `storage` and `gtag` are injectable for tests. */
export function trackImportEvent(event, slug, cta, { storage, gtag } = {}) {
  const params = importEventParams(event, slug, cta)
  if (!params) return false
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    const g = gtag ?? (typeof window !== 'undefined' ? window.gtag : null)
    if (typeof g !== 'function' || !store || !hasConsent('analytics', store)) return false
    g('event', event, params)
    return true
  } catch {
    return false
  }
}
