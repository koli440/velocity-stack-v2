// OAuth landing point for "Continue with Google" (redirectTo = <origin>/auth/callback?next=<path>).
//
// The browser Supabase client (src/lib/supabase.js) keeps its session in localStorage and uses the implicit
// flow, so Supabase returns the tokens in the URL fragment, which servers never see, and the client library
// stores them itself (detectSessionInUrl). A server-side exchangeCodeForSession could not hand a session to
// that client (no cookies, no PKCE verifier), so this route only does the parts that belong on the server:
//   * errors reported in the query (access_denied, ...) -> /login with a friendly message code
//   * a validated same-origin `next` (no open redirect), default dashboard
//   * everything else is answered with a tiny page that inspects the fragment: tokens -> continue to `next`
//     (fragment kept so the client library can finish sign-in), an error or nothing -> /login.
import { NextResponse } from 'next/server'
import { nextOrDefault, parseOAuthError } from '../../../lib/authRedirect'

export const dynamic = 'force-dynamic'

function toLogin(url, code) {
  const target = new URL('/login', url.origin)
  target.searchParams.set('error', code)
  return NextResponse.redirect(target, 303)
}

export async function GET(request) {
  const url = new URL(request.url)
  const queryError = parseOAuthError(url.search)
  if (queryError) return toLogin(url, queryError.error === 'access_denied' ? 'access_denied' : 'oauth_failed')

  // A PKCE `code` cannot be redeemed here: the verifier lives in the browser client's storage.
  if (url.searchParams.get('code')) return toLogin(url, 'oauth_failed')

  const next = nextOrDefault(url.searchParams.get('next')).split('#')[0]
  const script = `
var h = location.hash.slice(1), p = new URLSearchParams(h);
function go(u) { location.replace(u); }
if (p.get('error') || p.get('error_code')) {
  go('/login?error=' + (p.get('error') === 'access_denied' ? 'access_denied' : 'oauth_failed'));
} else if (p.get('access_token')) {
  go(${JSON.stringify(next).replace(/</g, '\\u003c')} + '#' + h);
} else {
  go('/login?error=missing_code');
}`
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Signing in…</title></head><body><p>Signing you in…</p><script>${script}</script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}
