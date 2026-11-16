import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { appOrigin } from '../../../../lib/server/appUrl'
import { stripeConfig, stripeFetch } from '../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// POST: Stripe customer portal for the signed-in rider's own subscription (cancel, payment method, invoices).
export async function POST(req) {
  const cfg = stripeConfig()
  const service = getServiceClient()
  if (!cfg.enabled || !service) return NextResponse.json({ error: 'Payments are not available yet' }, { status: 503 })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await service.rpc('billing_rider_customer', { p_rider: user.id })
  if (!data?.customer) return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
  try {
    const session = await stripeFetch(cfg, 'POST', '/v1/billing_portal/sessions', {
      customer: data.customer, return_url: `${appOrigin(req)}/settings/coach-card`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.warn('Portal failed:', err?.message)
    return NextResponse.json({ error: 'Could not open the billing portal' }, { status: 502 })
  }
}
