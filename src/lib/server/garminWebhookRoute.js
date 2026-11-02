import { NextResponse } from 'next/server'
import { getServiceClient } from './connections'
import { getSetting } from './stravaSetup'
import { handleGarminPush } from './garminWebhook'
import { appOrigin } from './appUrl'
import { authorizeGarminWebhook } from '../garmin'

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
// nothing, so the URL carries GARMIN_WEBHOOK_TOKEN as a path segment (the portal strips query strings); ?token= still works.
export async function handleGarminWebhook(req, pathToken) {
  const auth = authorizeGarminWebhook({ pathToken, queryToken: new URL(req.url).searchParams.get('token'), expected: process.env.GARMIN_WEBHOOK_TOKEN })
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? 'Not configured' : 'Forbidden' }, { status: auth.status })
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
