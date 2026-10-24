import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { signState } from '../../../../../lib/strava'
import { isWahooConfigured, buildAuthorizeUrl, wahooRedirectUri } from '../../../../../lib/wahoo'

export const dynamic = 'force-dynamic'

// The browser can't attach the auth header to a redirect, so the client calls this with its token
// and navigates to the returned URL. 503 { configured: false } when the Wahoo env vars are missing.
export async function GET(req) {
  try {
    if (!isWahooConfigured()) {
      return NextResponse.json({ configured: false, error: 'Wahoo is not configured on this deployment.' }, { status: 503 })
    }
    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const state = signState({
      userId: user.id,
      returnTo: new URL(req.url).searchParams.get('return') === 'home' ? 'home' : undefined,
      secret: process.env.WAHOO_CLIENT_SECRET,
    })
    const url = buildAuthorizeUrl({
      clientId: process.env.WAHOO_CLIENT_ID,
      redirectUri: wahooRedirectUri(),
      state,
    })
    return NextResponse.json({ configured: true, url })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not start Wahoo authorization' }, { status: 500 })
  }
}
