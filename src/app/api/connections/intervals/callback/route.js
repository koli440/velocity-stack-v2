import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { exchangeIntervalsCode } from '../../../../../lib/server/intervalsProvider'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { verifyState } from '../../../../../lib/strava'
import {
  isIntervalsOAuthConfigured,
  intervalsReturnPath,
  intervalsRedirectUri,
  intervalsTokenToColumns,
  INTERVALS_PKCE_COOKIE,
} from '../../../../../lib/intervalsOAuth'

export const dynamic = 'force-dynamic'

// Intervals.icu redirects the browser here after the rider approves. Identity comes from the signed state.
export async function GET(req) {
  const origin = appOrigin(req)
  let path = intervalsReturnPath()
  const back = (flag) => {
    const res = NextResponse.redirect(`${origin}${path}?intervals=${encodeURIComponent(flag)}`)
    res.cookies.set(INTERVALS_PKCE_COOKIE, '', { path: '/api/connections/intervals', maxAge: 0 })
    return res
  }
  try {
    if (!isIntervalsOAuthConfigured()) return back('not_configured')
    const params = new URL(req.url).searchParams
    const checked = verifyState({ state: params.get('state'), secret: process.env.INTERVALS_CLIENT_SECRET })
    if (!checked.ok) return back('invalid_state')
    path = intervalsReturnPath(checked.returnTo)
    if (params.get('error')) return back('denied')
    const code = params.get('code')
    const verifier = req.cookies.get(INTERVALS_PKCE_COOKIE)?.value
    if (!code || !verifier) return back(code ? 'invalid_state' : 'error')

    const service = getServiceClient()
    if (!service) return back('not_configured')

    const resp = await exchangeIntervalsCode({
      code,
      codeVerifier: verifier,
      redirectUri: intervalsRedirectUri(),
    })
    const cols = intervalsTokenToColumns(resp)
    if (!cols) return back('error')

    // Backfill settings are left untouched; a previously disconnected row resets its backfill via trigger.
    const { error } = await service.from('connections').upsert(
      {
        user_id: checked.userId,
        provider: 'intervals',
        external_athlete_id: cols.external_athlete_id,
        access_token: cols.access_token,
        api_key: null,
        status: 'active',
        last_error: null,
        last_attempt_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )
    if (error) throw error
    // Drop the legacy API key so nothing falls back to it.
    await service
      .from('profile_secrets')
      .update({ intervals_athlete_id: null, intervals_api_key: null, updated_at: new Date().toISOString() })
      .eq('user_id', checked.userId)
    return back('connected')
  } catch (err) {
    console.warn('Intervals.icu callback failed:', err?.message)
    return back('error')
  }
}
