// Recomputes and stores the gym load of one activity (after the editor saved it). Allowed for the rider and for a
// coach who can see the activity: visibility is checked with the caller's own token (RLS), the write uses the service role.
import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { computeAndStoreGymLoad } from '../../../../../lib/server/gymLoadStore'

export const dynamic = 'force-dynamic'

export async function POST(req, { params }) {
  const { supabase: rls, user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const { id } = await params
  const { data: own } = await rls.from('activities').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  let allowed = !!own
  if (!allowed) {
    const { data: shared } = await rls.from('shared_activities').select('id').eq('id', id).eq('activity_type', 'gym').maybeSingle()
    allowed = !!shared
  }
  if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const r = await computeAndStoreGymLoad(service, id)
    return NextResponse.json({ success: true, status: r.status, load: r.load ?? null })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
