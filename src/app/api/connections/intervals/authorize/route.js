import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { signState } from '../../../../../lib/strava'
import {
  isIntervalsOAuthConfigured,
  buildIntervalsAuthorizeUrl,
  intervalsRedirectUri,
  createPkcePair,
  INTERVALS_PKCE_COOKIE,
  INTERVALS_PKCE_TTL_S,
} from '../../../../../lib/intervalsOAuth'

export const dynamic = 'force-dynamic'

// The browser can't attach the auth header to a redirect, so the client calls this with its token and
// navigates to the returned URL. The PKCE verifier stays in an httpOnly cookie until the callback.
export async function GET(req) {
  try {
    if (!isIntervalsOAuthConfigured()) {
      return NextResponse.json({ configured: false, error: 'Intervals.icu OAuth is not configured on this deployment.' }, { status: 503 })
    }
    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const state = signState({
      userId: user.id,
      returnTo: new URL(req.url).searchParams.get('return') === 'home' ? 'home' : undefined,
      secret: process.env.INTERVALS_CLIENT_SECRET,
    })
    const { verifier, challenge } = createPkcePair()
    const url = buildIntervalsAuthorizeUrl({
      clientId: process.env.INTERVALS_CLIENT_ID,
      redirectUri: intervalsRedirectUri(),
      state,
      codeChallenge: challenge,
    })
    const res = NextResponse.json({ configured: true, url })
    res.cookies.set(INTERVALS_PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/connections/intervals',
      maxAge: INTERVALS_PKCE_TTL_S,
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not start Intervals.icu authorization' }, { status: 500 })
  }
}
