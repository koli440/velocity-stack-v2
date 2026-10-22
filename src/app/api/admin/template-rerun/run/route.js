// POST /api/admin/template-rerun/run: processes one time-boxed slice of the template re-run job (issue #283).
// Called by pg_cron every 5 minutes (x-sync-token, see 20261228010000_template_rerun_job.sql) and chained by
// itself while work remains. A no-op unless an admin has started the job.

import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../../lib/server/connections'
import { isCronToken } from '../../../../../lib/server/syncRoute'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { runBatches, supabaseStore } from '../../../../../lib/server/templateRerun'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const service = getServiceClient()
  if (!service) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const token = req.headers.get('x-sync-token')
  if (!(await isCronToken(service, token))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: claimed, error } = await service.rpc('template_rerun_claim', { p_lease_seconds: 90 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const job = Array.isArray(claimed) ? claimed[0] : claimed
  if (!job) return NextResponse.json({ skipped: 'not running or already being processed' })

  try {
    const result = await runBatches(supabaseStore(service), { dryRun: job.mode === 'dry_run', cursor: job.cursor })
    if (!result.finished && token) {
      const next = fetch(`${appOrigin(req)}/api/admin/template-rerun/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
        body: '{}',
      }).catch(() => null)
      await Promise.race([next, new Promise((r) => setTimeout(r, 1500))])
    }
    return NextResponse.json(result)
  } catch (err) {
    await service.rpc('template_rerun_progress', { p_cursor: job.cursor, p_finished: false })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
