// Post-login redirect handling for OAuth ("Continue with Google"). Only same-origin relative paths are
// accepted as `next` (no open redirect); everything else falls back to the dashboard.

export const DEFAULT_NEXT = '/'
const MAX_LENGTH = 500
// Pages that would send a signed-in user straight back into the auth flow.
const AUTH_PATHS = /^\/(?:login|register|forgot-password|reset-password|auth)(?:[/?#]|$)/

/** Returns a safe same-origin relative path, or null. */
export function safeNextPath(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.length > MAX_LENGTH) return null
  if (v[0] !== '/' || v[1] === '/' || v[1] === '\\') return null
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return null
  let url
  try {
    url = new URL(v, 'http://next.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'http://next.invalid') return null
  if (AUTH_PATHS.test(url.pathname)) return null
  return url.pathname + url.search + url.hash
}

export function nextOrDefault(value) {
  return safeNextPath(value) || DEFAULT_NEXT
}

/** Where Google sends the browser back to (must be in the Supabase redirect URL allow list). */
export function oauthRedirectTo(origin, next) {
  const safe = safeNextPath(next)
  return `${origin}/auth/callback${safe && safe !== DEFAULT_NEXT ? `?next=${encodeURIComponent(safe)}` : ''}`
}

/** Friendly message for the error params an OAuth round trip can come back with. */
export function oauthErrorMessage(error, description) {
  const code = String(error || '').toLowerCase()
  if (code === 'access_denied') return 'Google sign-in was cancelled. You can try again or use your email and password.'
  if (/different.*email|email.*(exists|taken|registered)|identity_already_exists/i.test(`${code} ${description || ''}`)) {
    return 'That email is already registered with another sign-in method. Sign in with your password instead.'
  }
  if (code === 'missing_code') return 'Google sign-in did not complete. Please try again.'
  return 'Google sign-in failed. Please try again or use your email and password.'
}

/** Reads `error`/`error_description` from a query string or a URL fragment (implicit flow puts them there). */
export function parseOAuthError(...params) {
  for (const raw of params) {
    const p = new URLSearchParams(String(raw || '').replace(/^[?#]/, ''))
    if (p.get('error') || p.get('error_code')) {
      return { error: p.get('error_code') || p.get('error'), description: p.get('error_description') || '' }
    }
  }
  return null
}
