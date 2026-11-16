import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { stripeConfig, stripeFetch } from '../../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// POST: creates (once) the coach's Express account and returns a hosted onboarding link.
export async function POST(req) {
  const cfg = stripeConfig()
  const service = getServiceClient()
  if (!cfg.enabled || !service) return NextResponse.json({ error: 'Payments are not available yet' }, { status: 503 })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { data: ready } = await service.rpc('billing_coach_ready', { p_coach: user.id })
    if (!ready) return NextResponse.json({ error: 'Not available' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const country = /^[A-Za-z]{2}$/.test(body?.country || '') ? body.country.toUpperCase() : undefined
    let { data: account } = await service.rpc('billing_get_account', { p_coach: user.id })
    if (!account) {
      const created = await stripeFetch(cfg, 'POST', '/v1/accounts', {
        type: 'express', country, metadata: { coach_id: user.id },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      }, { idempotencyKey: `acct-${user.id}` })
      const { error } = await service.rpc('billing_set_account', { p_coach: user.id, p_account: created.id, p_country: created.country || country || null })
      if (error) throw new Error(error.message)
      account = created.id
    }
    const origin = appOrigin(req)
    const link = await stripeFetch(cfg, 'POST', '/v1/account_links', {
      account, type: 'account_onboarding',
      refresh_url: `${origin}/settings/coach-card?connect=refresh`, return_url: `${origin}/settings/coach-card?connect=return`,
    })
    return NextResponse.json({ url: link.url })
  } catch (err) {
    console.warn('Connect onboarding failed:', err?.message)
    return NextResponse.json({ error: 'Could not start payment setup' }, { status: 502 })
  }
}
