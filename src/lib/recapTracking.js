// Recap analytics (GA4): views, shares and sign-ups. Every call is a no-op unless the visitor granted the
// analytics category (src/lib/consent.js), so nothing is sent before consent. See docs/season-recap.md.
import { hasConsent } from './consent.js'

export const RECAP_EVENTS = Object.freeze(['recap_view', 'recap_share', 'recap_cta_click', 'recap_signup'])
export const RECAP_CTA_KEY = 'vs.recapCta'

function storage(kind) {
  try {
    return window[kind]
  } catch {
    return null
  }
}

/** Sends a recap event (only with analytics consent and a loaded gtag). Returns whether it was sent. */
export function trackRecapEvent(name, params = {}) {
  if (typeof window === 'undefined' || !RECAP_EVENTS.includes(name)) return false
  if (typeof window.gtag !== 'function' || !hasConsent('analytics', storage('localStorage'))) return false
  window.gtag('event', name, params)
  return true
}

/** Visitor clicked the public-page call to action: count it and remember it so a later sign-up is attributed. */
export function trackRecapCta(year) {
  const sent = trackRecapEvent('recap_cta_click', { year })
  if (sent) {
    try {
      storage('sessionStorage')?.setItem(RECAP_CTA_KEY, String(year))
    } catch {}
  }
  return sent
}

/** Called after a sign-up: fires recap_signup once if this visitor came through a recap CTA. */
export function trackRecapSignUp() {
  const s = storage('sessionStorage')
  let year
  try {
    year = s?.getItem(RECAP_CTA_KEY)
  } catch {
    return false
  }
  if (!year) return false
  const sent = trackRecapEvent('recap_signup', { year: Number(year) })
  if (sent) {
    try {
      s.removeItem(RECAP_CTA_KEY)
    } catch {}
  }
  return sent
}
