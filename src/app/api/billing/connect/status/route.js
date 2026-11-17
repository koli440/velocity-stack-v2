import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { fetchAccountFlags, stripeConfig } from '../../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// GET: the coach's own billing state (flag enforced in the RPC) plus whether payments are configured at all.
// While the account is not yet ready it is re-read from Stripe, so status does not depend on webhook delivery
// (v2 account changes arrive as thin events that a snapshot destination does not receive).
export async function GET(req) {
  const { supabase, user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let { data, error } = await supabase.rpc('my_billing_status')
  if (error) return NextResponse.json({ error: 'Not available' }, { status: 403 })
  const cfg = stripeConfig()
  const service = getServiceClient()
  if (cfg.enabled && service && data.connected && !(data.charges_enabled && data.payouts_enabled)) {
    try {
      const { data: account } = await service.rpc('billing_get_account', { p_coach: user.id })
      const f = account && (await fetchAccountFlags(cfg, account))
      if (f) {
        await service.rpc('billing_apply_account', { p_account: account, p_charges: f.charges, p_payouts: f.payouts, p_details: f.details, p_country: f.country })
        data = { ...data, charges_enabled: f.charges, payouts_enabled: f.payouts, details_submitted: f.details }
      }
    } catch (err) {
      console.warn('Account status refresh failed:', err?.message)
    }
  }
  return NextResponse.json({ configured: cfg.enabled, ...data })
}
