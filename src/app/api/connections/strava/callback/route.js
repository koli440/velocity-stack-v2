import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { exchangeCode } from '../../../../../lib/server/stravaProvider'
import { ensureStravaWebhook } from '../../../../../lib/server/stravaSetup'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { isStravaConfigured, verifyState, stravaReturnPath, hasRequiredScope, tokensToColumns } from '../../../../../lib/strava'

export const dynamic = 'force-dynamic'

// Strava redirects the browser here after the rider approves. Identity comes from the signed state.
export async function GET(req) {
  const origin = appOrigin(req)
  let path = stravaReturnPath()
  const back = (flag) => NextResponse.redirect(`${origin}${path}?strava=${encodeURIComponent(flag)}`)
  try {
    if (!isStravaConfigured()) return back('not_configured')
    const params = new URL(req.url).searchParams
    const checked = verifyState({ state: params.get('state'), secret: process.env.STRAVA_CLIENT_SECRET })
    if (!checked.ok) return back('invalid_state')
    path = stravaReturnPath(checked.returnTo)
    if (params.get('error')) return back('denied')
    const code = params.get('code')
    if (!code) return back('error')
    if (!hasRequiredScope(params.get('scope'))) return back('missing_scope')

    const service = getServiceClient()
    if (!service) return back('not_configured')

    const token = await exchangeCode(code)
    const cols = tokensToColumns(token)
    const { error } = await service.from('connections').upsert(
      {
        user_id: checked.userId,
        provider: 'strava',
        external_athlete_id: token.athlete?.id != null ? String(token.athlete.id) : null,
        ...cols,
        status: 'active',
        last_error: null,
        last_synced_at: null,
        last_attempt_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )
    if (error) throw error

    // Best effort: webhook subscription is created once per Strava app; polling covers any failure.
    await ensureStravaWebhook(service, origin).catch((err) => console.warn('Strava webhook setup:', err?.message))
    return back('connected')
  } catch (err) {
    console.warn('Strava callback failed:', err?.message)
    return back('error')
  }
}
