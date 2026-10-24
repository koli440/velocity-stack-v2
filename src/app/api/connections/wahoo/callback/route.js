import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { exchangeCode, fetchWahooUserId } from '../../../../../lib/server/wahooProvider'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { verifyState } from '../../../../../lib/strava'
import { isWahooConfigured, wahooReturnPath, wahooRedirectUri, tokensToColumns } from '../../../../../lib/wahoo'

export const dynamic = 'force-dynamic'

// Wahoo redirects the browser here after the rider approves. Identity comes from the signed state.
export async function GET(req) {
  const origin = appOrigin(req)
  let path = wahooReturnPath()
  const back = (flag) => NextResponse.redirect(`${origin}${path}?wahoo=${encodeURIComponent(flag)}`)
  try {
    if (!isWahooConfigured()) return back('not_configured')
    const params = new URL(req.url).searchParams
    const checked = verifyState({ state: params.get('state'), secret: process.env.WAHOO_CLIENT_SECRET })
    if (!checked.ok) return back('invalid_state')
    path = wahooReturnPath(checked.returnTo)
    if (params.get('error')) return back('denied')
    const code = params.get('code')
    if (!code) return back('error')

    const service = getServiceClient()
    if (!service) return back('not_configured')

    const token = await exchangeCode(code, wahooRedirectUri())
    const cols = tokensToColumns(token)
    const wahooUserId = await fetchWahooUserId(token.access_token)
    const { error } = await service.from('connections').upsert(
      {
        user_id: checked.userId,
        provider: 'wahoo',
        external_athlete_id: wahooUserId,
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
    return back('connected')
  } catch (err) {
    console.warn('Wahoo callback failed:', err?.message)
    return back('error')
  }
}
