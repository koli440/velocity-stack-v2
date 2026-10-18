import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { getSetting } from '../../../../lib/server/stravaSetup'
import { handleStravaEvent } from '../../../../lib/server/stravaWebhook'
import { appOrigin } from '../../../../lib/server/appUrl'
import { validateSubscriptionRequest } from '../../../../lib/strava'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Subscription validation: Strava calls GET with hub.mode/hub.verify_token/hub.challenge.
export async function GET(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const p = new URL(req.url).searchParams
  const expected = await getSetting(service, 'strava_webhook_verify_token')
  const echo = validateSubscriptionRequest(
    { mode: p.get('hub.mode'), token: p.get('hub.verify_token'), challenge: p.get('hub.challenge') },
    expected
  )
  if (!echo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(echo)
}

// Starts the rider's sync via our own authenticated run endpoint and returns quickly: Strava expects a
// 200 within 2 s and the import itself continues in its own invocation.
function makeTriggerSync(req, service) {
  return async (userId) => {
    const token = await getSetting(service, 'cron_token')
    if (!token) return
    const run = fetch(`${appOrigin(req)}/api/sync/strava/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({ userId }),
    }).catch(() => null)
    await Promise.race([run, new Promise((r) => setTimeout(r, 1000))])
  }
}

export async function POST(req) {
  try {
    const service = getServiceClient()
    if (!service) return NextResponse.json({ received: true })
    const body = await req.json().catch(() => null)
    const result = await handleStravaEvent(service, body, { triggerSync: makeTriggerSync(req, service) })
    return NextResponse.json({ received: true, handled: result.handled })
  } catch (err) {
    // Always 200: Strava would retry, and the 15-minute polling run is the fallback.
    console.warn('Strava webhook failed:', err?.message)
    return NextResponse.json({ received: true })
  }
}
