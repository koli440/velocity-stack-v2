// Self-service backfill: scores the signed-in rider's gym sessions that were never scored or are stale (a small batch
// per call, oldest first). Called by the fitness and activity pages so no one has to run anything manually.
import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { getServiceClient } from '../../../lib/server/connections'
import { backfillGymLoads } from '../../../lib/server/gymLoadStore'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  try {
    return NextResponse.json({ success: true, ...(await backfillGymLoads(service, { userId: user.id })) })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
