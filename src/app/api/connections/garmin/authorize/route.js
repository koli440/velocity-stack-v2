import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { signState } from '../../../../../lib/strava'
import {
  isGarminConfigured,
  buildAuthorizeUrl,
  garminAuthorizeUrl,
  garminRedirectUri,
  createPkcePair,
  GARMIN_PKCE_COOKIE,
  GARMIN_PKCE_TTL_S,
} from '../../../../../lib/garmin'

export const dynamic = 'force-dynamic'

// The browser can't attach the auth header to a redirect, so the client calls this with its token and navigates
// to the returned URL. The PKCE verifier stays in an httpOnly cookie until the callback.
export async function GET(req) {
  try {
    if (!isGarminConfigured()) {
      return NextResponse.json({ configured: false, error: 'Garmin is not configured on this deployment.' }, { status: 503 })
    }
    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const state = signState({
      userId: user.id,
      returnTo: new URL(req.url).searchParams.get('return') === 'home' ? 'home' : undefined,
      secret: process.env.GARMIN_CLIENT_SECRET,
    })
    const { verifier, challenge } = createPkcePair()
    const url = buildAuthorizeUrl({
      clientId: process.env.GARMIN_CLIENT_ID,
      redirectUri: garminRedirectUri(),
      state,
      codeChallenge: challenge,
      base: garminAuthorizeUrl(),
    })
    const res = NextResponse.json({ configured: true, url })
    res.cookies.set(GARMIN_PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/connections/garmin',
      maxAge: GARMIN_PKCE_TTL_S,
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not start Garmin authorization' }, { status: 500 })
  }
}
