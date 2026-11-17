import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { normalizeConnectCountry } from '../../../../../lib/coachBilling'
import { createCoachAccountV2, createOnboardingLink, stripeConfig } from '../../../../../lib/server/stripe'

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
    const country = normalizeConnectCountry(body?.country)
    let { data: account } = await service.rpc('billing_get_account', { p_coach: user.id })
    if (!account) {
      if (!country) return NextResponse.json({ error: 'Choose your country' }, { status: 400 })
      const created = await createCoachAccountV2(cfg, { coachId: user.id, email: user.email, country })
      const { error } = await service.rpc('billing_set_account', { p_coach: user.id, p_account: created.id, p_country: created.identity?.country ? String(created.identity.country).toUpperCase() : country || null })
      if (error) throw new Error(error.message)
      account = created.id
    }
    const url = await createOnboardingLink(cfg, account, appOrigin(req))
    return NextResponse.json({ url })
  } catch (err) {
    console.warn('Connect onboarding failed:', err?.message)
    return NextResponse.json({ error: 'Could not start payment setup' }, { status: 502 })
  }
}
