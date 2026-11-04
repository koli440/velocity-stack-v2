import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../lib/server/connections'
import { disconnectApp } from '../../../../lib/server/partnerAdmin'

export const dynamic = 'force-dynamic'

// Disconnect: revokes every grant of this app for the signed-in rider.
export async function DELETE(req, { params }) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'Not available on this deployment' }, { status: 503 })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^[0-9a-f-]{36}$/i.test(params.appId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const revoked = await disconnectApp(service, user.id, params.appId)
  return NextResponse.json({ ok: true, revoked })
}
