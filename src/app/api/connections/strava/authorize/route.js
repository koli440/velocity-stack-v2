import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { isStravaConfigured, buildAuthorizeUrl, signState } from '../../../../../lib/strava'
import { appOrigin } from '../../../../../lib/server/appUrl'

export const dynamic = 'force-dynamic'

// The browser can't attach the Bearer token to a redirect, so the client calls this with its token
// and navigates to the returned URL. 503 { configured: false } when the Strava env vars are missing.
export async function GET(req) {
  try {
    if (!isStravaConfigured()) {
      return NextResponse.json({ configured: false, error: 'Strava is not configured on this deployment.' }, { status: 503 })
    }
    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const state = signState({
      userId: user.id,
      returnTo: new URL(req.url).searchParams.get('return') === 'home' ? 'home' : undefined,
      secret: process.env.STRAVA_CLIENT_SECRET,
    })
    const url = buildAuthorizeUrl({
      clientId: process.env.STRAVA_CLIENT_ID,
      redirectUri: `${appOrigin(req)}/api/connections/strava/callback`,
      state,
    })
    return NextResponse.json({ configured: true, url })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not start Strava authorization' }, { status: 500 })
  }
}
