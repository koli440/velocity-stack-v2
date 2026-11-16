import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { stripeConfig } from '../../../../../lib/server/stripe'

export const dynamic = 'force-dynamic'

// GET: the coach's own billing state (flag enforced in the RPC) plus whether payments are configured at all.
export async function GET(req) {
  const { supabase, user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.rpc('my_billing_status')
  if (error) return NextResponse.json({ error: 'Not available' }, { status: 403 })
  return NextResponse.json({ configured: stripeConfig().enabled, ...data })
}
