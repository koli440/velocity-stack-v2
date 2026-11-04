import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { getServiceClient } from '../../../lib/server/connections'
import { loadRiderGrants } from '../../../lib/server/partnerAdmin'
import { connectedAppsView } from '../../../lib/partnerApps'

export const dynamic = 'force-dynamic'

// The rider's own connected partner apps (never token hashes).
export async function GET(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ apps: [] })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { grants, apps } = await loadRiderGrants(service, user.id)
  return NextResponse.json({ apps: connectedAppsView(grants, apps) }, { headers: { 'Cache-Control': 'no-store' } })
}
