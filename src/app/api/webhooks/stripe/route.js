import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { handleStripeEvent, stripeConfig, verifyStripeSignature } from '../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// Stripe webhook (test mode), Connect events included (`account` set). Signing secrets: STRIPE_WEBHOOK_SECRET and optionally STRIPE_CONNECT_WEBHOOK_SECRET; the raw body is verified before
// anything is parsed. Errors return 500 so Stripe retries; only event type/id are logged.
export async function POST(req) {
  const cfg = stripeConfig()
  const service = getServiceClient()
  if (!cfg.enabled || !(cfg.webhookSecret || cfg.connectWebhookSecret) || !service) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const raw = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (![cfg.webhookSecret, cfg.connectWebhookSecret].some((s) => s && verifyStripeSignature(raw, sig, s))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  try {
    const r = await handleStripeEvent(service, event)
    return NextResponse.json({ received: true, handled: r.handled })
  } catch (err) {
    console.warn('Stripe webhook failed:', event?.type, event?.id, err?.message)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
