import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { requireAdmin } from '../../../../lib/server/adminAuth'
import { listAllApps } from '../../../../lib/server/partnerAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'Not available on this deployment' }, { status: 503 })
  const a = await requireAdmin(req, service)
  if (!a.ok) return NextResponse.json({ error: a.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: a.status })
  return NextResponse.json(await listAllApps(service), { headers: { 'Cache-Control': 'no-store' } })
}
