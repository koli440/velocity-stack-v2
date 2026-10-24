import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { getSetting } from '../../../../lib/server/stravaSetup'
import { handleIntervalsWebhook } from '../../../../lib/server/intervalsWebhook'
import { appOrigin } from '../../../../lib/server/appUrl'
import { isAuthorizedWebhook } from '../../../../lib/intervalsWebhook'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Starts our own authenticated run endpoint and returns quickly so Intervals.icu gets its 200 fast; the work continues
// in its own invocation. The 15-minute cron is the safety net for missed deliveries.
function makeTrigger(req, service) {
  const call = async (path, body) => {
    const token = await getSetting(service, 'cron_token')
    if (!token) return
    const run = fetch(`${appOrigin(req)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify(body),
    }).catch(() => null)
    await Promise.race([run, new Promise((r) => setTimeout(r, 1000))])
  }
  return {
    triggerSync: (userId) => call('/api/sync/intervals/run', { userId }),
    triggerPush: () => call('/api/planned-workouts/push/run', {}),
  }
}

export async function POST(req) {
  const expected = process.env.INTERVALS_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  try {
    const body = await req.json().catch(() => null)
    if (!isAuthorizedWebhook({ bodySecret: body?.secret, authorization: req.headers.get('authorization') }, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const service = getServiceClient()
    if (!service) return NextResponse.json({ received: true })
    const result = await handleIntervalsWebhook(service, body, makeTrigger(req, service))
    return NextResponse.json({ received: true, handled: result.handled })
  } catch (err) {
    // 200: the 15-minute polling run is the fallback.
    console.warn('Intervals webhook failed:', err?.message)
    return NextResponse.json({ received: true })
  }
}
