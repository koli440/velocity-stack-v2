import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { runIntervalsSync } from '../../../../../lib/server/intervalsSync'
import { pickDueConnections, manualCooldownRemaining } from '../../../../../lib/syncPlan'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const TIME_BUDGET_MS = 45000
const CRON_BATCH = 10
const COLUMNS = 'id, user_id, external_athlete_id, api_key, backfill_days, status, last_synced_at, last_attempt_at'

// Absolute /api/analyze URL on this deployment (a background job has no browser origin).
function makeAnalyzeFit(req) {
  return async (blob, filename, { chainring, cog, isFixedGear } = {}) => {
    const formData = new FormData()
    formData.append('file', blob, filename)
    if (chainring) formData.append('chainring', String(chainring))
    if (cog) formData.append('cog', String(cog))
    if (isFixedGear) formData.append('is_fixed_gear', 'true')
    const res = await fetch(new URL('/api/analyze', req.url).toString(), { method: 'POST', body: formData })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null
    return res.json()
  }
}

async function isCronToken(service, token) {
  if (!token) return false
  const { data } = await service.from('sync_settings').select('value').eq('key', 'cron_token').maybeSingle()
  if (!data?.value) return false
  const a = Buffer.from(token)
  const b = Buffer.from(data.value)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Marks connections as attempted so overlapping runs/manual syncs don't pick them up again.
async function claim(service, rows) {
  const claimed = []
  for (const row of rows) {
    let q = service
      .from('connections')
      .update({ last_attempt_at: new Date().toISOString() })
      .eq('id', row.id)
    q = row.last_attempt_at ? q.eq('last_attempt_at', row.last_attempt_at) : q.is('last_attempt_at', null)
    const { data } = await q.select('id')
    if (data?.length) claimed.push(row)
  }
  return claimed
}

// Cron: all due active connections (token in x-sync-token). Manual: the signed-in caller's own connection.
export async function POST(req) {
  try {
    const service = getServiceClient()
    if (!service) {
      return NextResponse.json({ error: 'Background sync is not configured on this deployment.' }, { status: 503 })
    }
    const deadline = Date.now() + TIME_BUDGET_MS
    const deps = { analyzeFit: makeAnalyzeFit(req), deadline }

    const token = req.headers.get('x-sync-token')
    if (token) {
      if (!(await isCronToken(service, token))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { data, error } = await service
        .from('connections')
        .select(COLUMNS)
        .eq('provider', 'intervals')
        .eq('status', 'active')
        .not('api_key', 'is', null)
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .limit(100)
      if (error) throw error
      const due = await claim(service, pickDueConnections(data, { limit: CRON_BATCH }))
      const results = await runIntervalsSync(service, due, deps)
      return NextResponse.json({ success: true, connections: results.length, results: results.map(({ userId, ...r }) => r) })
    }

    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: row, error } = await service
      .from('connections')
      .select(COLUMNS)
      .eq('user_id', user.id)
      .eq('provider', 'intervals')
      .maybeSingle()
    if (error) throw error
    if (!row || row.status === 'disconnected' || !row.api_key) {
      return NextResponse.json({ error: 'Intervals.icu is not connected.' }, { status: 400 })
    }
    const wait = manualCooldownRemaining(row.last_attempt_at)
    if (wait > 0) {
      return NextResponse.json({ error: `Please wait ${wait}s before syncing again.`, retryAfter: wait }, { status: 429 })
    }
    const [claimed] = await claim(service, [row])
    if (!claimed) {
      return NextResponse.json({ error: 'A sync is already running.' }, { status: 429 })
    }
    const [result] = await runIntervalsSync(service, [claimed], deps)
    const { userId, ...rest } = result
    return NextResponse.json({ success: !rest.error, ...rest })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Sync failed' }, { status: 500 })
  }
}
