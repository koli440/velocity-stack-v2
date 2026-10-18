import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { isCronToken } from '../../../../../lib/server/syncRoute'
import { runPlannedPushCycle } from '../../../../../lib/server/plannedPush'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Cron entry (pg_cron -> pg_net, x-sync-token). Pushes planned workouts of riders who enabled the auto push
// and propagates deletions; one failing rider never blocks the others.
export async function POST(req) {
  try {
    const service = getServiceClient()
    if (!service) return NextResponse.json({ error: 'Server is not configured' }, { status: 503 })
    const token = req.headers.get('x-sync-token')
    if (!token || !(await isCronToken(service, token))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const totals = await runPlannedPushCycle({ service })
    return NextResponse.json({ success: true, ...totals })
  } catch {
    return NextResponse.json({ error: 'Run failed' }, { status: 500 })
  }
}
