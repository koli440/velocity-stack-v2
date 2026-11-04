import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { registerApp, listOwnApps } from '../../../../lib/server/partnerAdmin'
import { validateRegistration, RegistrationError } from '../../../../lib/partnerApps'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

async function ctx(req) {
  const service = getServiceClient()
  if (!service) return { res: NextResponse.json({ error: 'Not available on this deployment' }, { status: 503 }) }
  const { user } = await getRequestUser(req)
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { service, user }
}

export async function GET(req) {
  const { service, user, res } = await ctx(req)
  if (res) return res
  return NextResponse.json({ apps: await listOwnApps(service, user.id) }, { headers: NO_STORE })
}

// Registers a pending app; the client secret (confidential apps) is returned once and stored hashed.
export async function POST(req) {
  const { service, user, res } = await ctx(req)
  if (res) return res
  let reg
  try {
    reg = validateRegistration(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof RegistrationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }
  const r = await registerApp(service, user.id, reg)
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ app: r.app, client_secret: r.clientSecret }, { status: 201, headers: NO_STORE })
}
