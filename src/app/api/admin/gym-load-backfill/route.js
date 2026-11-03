// Admin: score gym sessions for every rider (batch per call; call again while `remaining` > 0).
//   POST { userId?, limit?, rescore? }  rescore also takes rows scored by an older model version.
import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { requireAdmin } from '../../../../lib/server/adminAuth'
import { backfillGymLoads } from '../../../../lib/server/gymLoadStore'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const admin = await requireAdmin(req, service)
  if (!admin.ok) return NextResponse.json({ error: admin.status === 401 ? 'Unauthorized' : 'Admins only' }, { status: admin.status })
  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 25, 1), 100)
  try {
    const r = await backfillGymLoads(service, { userId: typeof body.userId === 'string' ? body.userId : null, limit, rescore: !!body.rescore })
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
