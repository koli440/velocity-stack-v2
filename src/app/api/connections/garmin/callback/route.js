import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { exchangeCode, fetchGarminUserId, fetchGarminPermissions } from '../../../../../lib/server/garminProvider'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { verifyState } from '../../../../../lib/strava'
import {
  isGarminConfigured,
  garminReturnPath,
  garminRedirectUri,
  tokensToColumns,
  permissionFlags,
  GARMIN_PKCE_COOKIE,
  NO_ACTIVITY_PERMISSION_MESSAGE,
  NO_WORKOUT_PERMISSION_MESSAGE,
} from '../../../../../lib/garmin'

export const dynamic = 'force-dynamic'

// Garmin redirects the browser here after the rider approves. Identity comes from the signed state.
export async function GET(req) {
  const origin = appOrigin(req)
  let path = garminReturnPath()
  const back = (flag) => {
    const res = NextResponse.redirect(`${origin}${path}?garmin=${encodeURIComponent(flag)}`)
    res.cookies.set(GARMIN_PKCE_COOKIE, '', { path: '/api/connections/garmin', maxAge: 0 })
    return res
  }
  try {
    if (!isGarminConfigured()) return back('not_configured')
    const params = new URL(req.url).searchParams
    const checked = verifyState({ state: params.get('state'), secret: process.env.GARMIN_CLIENT_SECRET })
    if (!checked.ok) return back('invalid_state')
    path = garminReturnPath(checked.returnTo)
    if (params.get('error')) return back('denied')
    const code = params.get('code')
    const verifier = req.cookies.get(GARMIN_PKCE_COOKIE)?.value
    if (!code || !verifier) return back(code ? 'invalid_state' : 'error')

    const service = getServiceClient()
    if (!service) return back('not_configured')

    const token = await exchangeCode(code, garminRedirectUri(), verifier)
    const cols = tokensToColumns(token)
    if (!cols) throw new Error('Garmin returned no tokens')
    const garminUserId = await fetchGarminUserId(token.access_token)
    const flags = permissionFlags(await fetchGarminPermissions(token.access_token))
    const now = new Date().toISOString()
    const { error } = await service.from('connections').upsert(
      {
        user_id: checked.userId,
        provider: 'garmin',
        external_athlete_id: garminUserId,
        ...cols,
        status: 'active',
        last_error: flags.activities ? null : NO_ACTIVITY_PERMISSION_MESSAGE,
        planned_push_error: flags.workouts ? null : NO_WORKOUT_PERMISSION_MESSAGE,
        // Garmin Starter only pushes new activities: there is nothing to backfill.
        last_synced_at: now,
        backfill_complete: true,
        last_attempt_at: null,
        updated_at: now,
      },
      { onConflict: 'user_id,provider' }
    )
    if (error) throw error
    return back('connected')
  } catch (err) {
    console.warn('Garmin callback failed:', err?.message)
    return back('error')
  }
}
