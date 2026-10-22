// Admin-only control and report for the template re-run job (issue #283).
//   GET  -> counts, job state and the report (per-run results)  [?dry=1 for the dry-run report, ?status=failed|skipped|done]
//   POST -> { action: 'dry_run' | 'start' | 'pause' | 'restore', executionId? }
// 'start' / 'dry_run' only flip the job to "running"; pg_cron (every 5 min) and the run route do the work.

import { NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/server/connections'
import { requireAdmin } from '../../../../lib/server/adminAuth'

export const dynamic = 'force-dynamic'

const guard = async (req) => {
  const service = getServiceClient()
  if (!service) return { res: NextResponse.json({ error: 'not configured' }, { status: 503 }) }
  const admin = await requireAdmin(req, service)
  if (!admin.ok) return { res: NextResponse.json({ error: admin.status === 401 ? 'Unauthorized' : 'Admins only' }, { status: admin.status }) }
  return { service, user: admin.user }
}

export async function GET(req) {
  const g = await guard(req)
  if (g.res) return g.res
  const { searchParams } = new URL(req.url)
  const dry = searchParams.get('dry') === '1'
  const status = ['done', 'skipped', 'failed', 'restored'].includes(searchParams.get('status')) ? searchParams.get('status') : null
  const { data: counts, error } = await g.service.rpc('template_rerun_counts')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let q = g.service
    .from('template_rerun_items')
    .select('execution_id, activity_id, template_slug, by_coach, status, reason, warning, attempts, had_rep_analysis_before, efforts_before, efforts_after, processed_at')
    .eq('dry_run', dry)
    .order('processed_at', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)
  const { data: items } = await q
  return NextResponse.json({ counts, items: items || [] })
}

export async function POST(req) {
  const g = await guard(req)
  if (g.res) return g.res
  const body = await req.json().catch(() => ({}))
  if (body.action === 'start' || body.action === 'dry_run') {
    const { data, error } = await g.service.rpc('template_rerun_start', { p_mode: body.action === 'start' ? 'apply' : 'dry_run', p_user: g.user.id })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ started: !!data, message: data ? 'Job started; it runs in the background.' : 'Already running.' })
  }
  if (body.action === 'pause') {
    await g.service.rpc('template_rerun_pause')
    return NextResponse.json({ paused: true })
  }
  if (body.action === 'restore' && typeof body.executionId === 'string') {
    const { data, error } = await g.service.rpc('template_rerun_restore', { p_execution: body.executionId })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ restored: !!data })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
