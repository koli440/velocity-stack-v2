// Sign-up conversion tracking: GA4 `sign_up` + Reddit `SignUp` (see docs/analytics.md).
import { trackRedditEvent } from './redditPixel.js'

export const ATTRIBUTION_KEY = 'vs.attribution'
export const OAUTH_PENDING_KEY = 'vs.oauthSignup'
const TRACKED_PREFIX = 'vs.signupTracked.'
const ATTRIBUTION_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid']
// Supabase sets created_at and last_sign_in_at together for a brand-new account.
const NEW_USER_WINDOW_MS = 2 * 60 * 1000

/** Picks utm_source/medium/campaign and gclid from a query string (values trimmed and length-capped). */
export function parseAttribution(search) {
  const p = new URLSearchParams(String(search ?? ''))
  const out = {}
  for (const k of ATTRIBUTION_PARAMS) {
    const v = (p.get(k) || '').trim().slice(0, 200)
    if (v) out[k] = v
  }
  return out
}

/** True for an account created just now via Google (first sign-in), not a later login. */
export function isNewGoogleUser(user, now = Date.now()) {
  if (!user || user.app_metadata?.provider !== 'google') return false
  const created = Date.parse(user.created_at)
  const last = Date.parse(user.last_sign_in_at)
  if (Number.isNaN(created) || Number.isNaN(last)) return false
  return Math.abs(last - created) <= NEW_USER_WINDOW_MS && now - created <= 10 * NEW_USER_WINDOW_MS
}

/** GA4 sign_up (no-op when gtag is not loaded) plus the Reddit SignUp event. */
export function trackSignUp(method, attribution = {}) {
  if (typeof window === 'undefined') return
  if (typeof window.gtag === 'function') {
    const params = { method }
    if (attribution.utm_source) params.campaign_source = attribution.utm_source
    if (attribution.utm_medium) params.campaign_medium = attribution.utm_medium
    if (attribution.utm_campaign) params.campaign = attribution.utm_campaign
    window.gtag('event', 'sign_up', params)
  }
  trackRedditEvent('SignUp')
}

function store(kind) {
  try {
    return window[kind]
  } catch {
    return null
  }
}

/** Called right before redirecting to Google: remember the campaign params and that a sign-in is in flight. */
export function rememberOAuthStart(search) {
  const s = store('sessionStorage')
  if (!s) return
  try {
    const attribution = parseAttribution(search)
    if (Object.keys(attribution).length) s.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution))
    s.setItem(OAUTH_PENDING_KEY, '1')
  } catch {}
}

/**
 * Called on SIGNED_IN. Fires sign-up events once for an account that was just created through our
 * Google flow; returns whether it fired. Later logins never match (flag, account age and per-user marker).
 */
export function trackOAuthSignUpOnce(user) {
  const s = store('sessionStorage')
  const l = store('localStorage')
  if (!s || !user?.id) return false
  try {
    if (s.getItem(OAUTH_PENDING_KEY) !== '1') return false
    s.removeItem(OAUTH_PENDING_KEY)
    const attribution = JSON.parse(s.getItem(ATTRIBUTION_KEY) || '{}')
    s.removeItem(ATTRIBUTION_KEY)
    if (!isNewGoogleUser(user)) return false
    const key = TRACKED_PREFIX + user.id
    if (l?.getItem(key)) return false
    l?.setItem(key, '1')
    trackSignUp('google', attribution)
    return true
  } catch {
    return false
  }
}
