import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { appOrigin } from '../../../../lib/server/appUrl'
import { buildCheckoutParams, ensureConnectedCustomer, stripeConfig, stripeFetch } from '../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// POST { packageId }: all authorisation rules live in billing_checkout_context (flag, relationship, blocks, minors).
export async function POST(req) {
  const cfg = stripeConfig()
  const service = getServiceClient()
  if (!cfg.enabled || !service) return NextResponse.json({ error: 'Payments are not available yet' }, { status: 503 })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body?.packageId !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { data: ctx, error } = await service.rpc('billing_checkout_context', { p_rider: user.id, p_package: body.packageId })
  if (error) return NextResponse.json({ error: error.message.replace(/^.*?:\s*/, '') }, { status: 400 })
  try {
    const customer = await ensureConnectedCustomer(cfg, service, ctx, user.id)
    const params = buildCheckoutParams(ctx, user.id, appOrigin(req), cfg.applicationFeePercent, customer)
    const session = await stripeFetch(cfg, 'POST', '/v1/checkout/sessions', params, { stripeAccount: ctx.stripe_account_id })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.warn('Checkout failed:', err?.message)
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  }
}
