// src/lib/partnerOAuth.js
//
// Pure helpers of our OAuth 2.0 provider for partner apps: token generation/hashing, PKCE (S256 only),
// exact redirect-URI matching and scope handling. No I/O.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const PARTNER_SCOPES = Object.freeze(['activities:write', 'profile:read'])
export const SCOPE_LABELS = Object.freeze({
  'activities:write': 'Upload rides and workouts to your account',
  'profile:read': 'Read your FTP, weight and units',
})
export const CODE_TTL_S = 600
export const ACCESS_TTL_S = 3600
export const REFRESH_TTL_S = 60 * 60 * 24 * 180

export const newToken = (prefix = 'vs') => `${prefix}_${randomBytes(32).toString('base64url')}`
export const hashToken = (token) => createHash('sha256').update(String(token ?? '')).digest('hex')

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

/** RFC 7636: verifier is 43-128 unreserved chars; challenge = base64url(sha256(verifier)). */
export function verifyPkce(verifier, challenge) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(String(verifier ?? ''))) return false
  return safeEqual(createHash('sha256').update(verifier).digest('base64url'), challenge)
}
export const isValidChallenge = (c) => /^[A-Za-z0-9\-_]{43}$/.test(String(c ?? ''))

/** Exact match only (no prefix/wildcard); https required except loopback for local development. */
export function isAllowedRedirectUri(uri, registered = []) {
  if (!registered.includes(uri)) return false
  return isValidRedirectUri(uri)
}
export function isValidRedirectUri(uri) {
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

/** Requested scopes must be known and allowed for the app; empty request = the app's scopes. */
export function resolveScopes(requested, appScopes = []) {
  const list = String(requested || '').split(/[\s,]+/).filter(Boolean)
  if (list.length === 0) return appScopes.filter((s) => PARTNER_SCOPES.includes(s))
  if (!list.every((s) => PARTNER_SCOPES.includes(s) && appScopes.includes(s))) return null
  return [...new Set(list)]
}

/** Redirect target with code/state (or error) appended; keeps any existing query. */
export function buildRedirect(redirectUri, params) {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v)
  return u.toString()
}

export function oauthError(error, description, status = 400) {
  return { status, body: { error, error_description: description } }
}
