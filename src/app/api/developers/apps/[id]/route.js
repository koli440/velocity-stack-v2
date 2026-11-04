import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { deleteOwnApp } from '../../../../../lib/server/partnerAdmin'

export const dynamic = 'force-dynamic'

// Deleting an app also removes its grants (cascade): connected riders lose access at once.
export async function DELETE(req, { params }) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'Not available on this deployment' }, { status: 503 })
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteOwnApp(service, user.id, params.id)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
