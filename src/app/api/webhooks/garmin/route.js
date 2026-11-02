import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { getSetting } from '../../../../lib/server/stravaSetup'
import { handleGarminPush } from '../../../../lib/server/garminWebhook'
import { appOrigin } from '../../../../lib/server/appUrl'
import { matchesWebhookToken } from '../../../../lib/garmin'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Starts the rider's sync via our own authenticated run endpoint and returns quickly: Garmin expects a 200 within
// seconds, and the import itself continues in its own invocation.
function makeTriggerSync(req, service) {
  return async (userId) => {
    const token = await getSetting(service, 'cron_token')
    if (!token) return
    const run = fetch(`${appOrigin(req)}/api/sync/garmin/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({ userId }),
    }).catch(() => null)
    await Promise.race([run, new Promise((r) => setTimeout(r, 1000))])
  }
}

// One URL serves every Garmin data type (activity files, deregistrations, permission changes). Garmin signs
// nothing, so the portal URL carries ?token=GARMIN_WEBHOOK_TOKEN.
export async function POST(req) {
  const expected = process.env.GARMIN_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  if (!matchesWebhookToken(new URL(req.url).searchParams.get('token'), expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json().catch(() => null)
    const service = getServiceClient()
    if (!service) return NextResponse.json({ received: true })
    const result = await handleGarminPush(service, body, { triggerSync: makeTriggerSync(req, service) })
    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    // 200 anyway: Garmin would only retry the same payload, and the 15-minute run is the safety net.
    console.warn('Garmin webhook failed:', err?.message)
    return NextResponse.json({ received: true })
  }
}
