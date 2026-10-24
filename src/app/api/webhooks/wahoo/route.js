import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { getSetting } from '../../../../lib/server/stravaSetup'
import { handleWahooEvent } from '../../../../lib/server/wahooWebhook'
import { appOrigin } from '../../../../lib/server/appUrl'
import { matchesWebhookToken } from '../../../../lib/wahoo'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Starts the rider's sync via our own authenticated run endpoint and returns quickly: the import itself
// continues in its own invocation, so Wahoo gets its 200 fast (non-200 would be retried after 30 min, 4 h, ...).
function makeTriggerSync(req, service) {
  return async (userId) => {
    const token = await getSetting(service, 'cron_token')
    if (!token) return
    const run = fetch(`${appOrigin(req)}/api/sync/wahoo/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({ userId }),
    }).catch(() => null)
    await Promise.race([run, new Promise((r) => setTimeout(r, 1000))])
  }
}

export async function POST(req) {
  const expected = process.env.WAHOO_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  try {
    const body = await req.json().catch(() => null)
    // Wahoo asks receivers to ignore requests that do not carry the configured token.
    if (!matchesWebhookToken(body?.webhook_token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const service = getServiceClient()
    if (!service) return NextResponse.json({ received: true })
    const result = await handleWahooEvent(service, body, { triggerSync: makeTriggerSync(req, service) })
    return NextResponse.json({ received: true, handled: result.handled })
  } catch (err) {
    // 200: the 15-minute polling run is the fallback.
    console.warn('Wahoo webhook failed:', err?.message)
    return NextResponse.json({ received: true })
  }
}
