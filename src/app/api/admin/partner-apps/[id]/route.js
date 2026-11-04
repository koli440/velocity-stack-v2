import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { requireAdmin } from '../../../../../lib/server/adminAuth'
import { setAppStatus } from '../../../../../lib/server/partnerAdmin'

export const dynamic = 'force-dynamic'
const STATUSES = ['approved', 'suspended', 'pending']

// Body: { status: 'approved' | 'suspended' | 'pending' }. Suspending cuts off the app's tokens immediately.
export async function POST(req, { params }) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'Not available on this deployment' }, { status: 503 })
  const a = await requireAdmin(req, service)
  if (!a.ok) return NextResponse.json({ error: a.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: a.status })
  const { status } = await req.json().catch(() => ({}))
  if (!STATUSES.includes(status) || !/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const ok = await setAppStatus(service, a.user.id, params.id, status)
  return ok ? NextResponse.json({ ok: true, status }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
