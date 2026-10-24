// src/lib/server/syncRoute.js
// Shared handler for POST /api/sync/{intervals,strava,wahoo}/run: cron mode (x-sync-token) syncs all due
// connections of the provider, manual mode syncs the signed-in caller's own connection.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getRequestUser } from '../supabaseServer'
import { getServiceClient } from './connections'
import { runIntervalsSync } from './intervalsSync'
import { loadStravaBudget } from './stravaBudget'
import { appOrigin } from './appUrl'
import { getSetting } from './stravaSetup'
import {
  pickDueConnections,
  manualCooldownRemaining,
  shouldChain,
  PROVIDER_LABELS,
  CHAIN_MIN_INTERVAL_S,
  CRON_MIN_INTERVAL_S,
  MAX_CHAIN_DEPTH,
} from '../syncPlan'

export const TIME_BUDGET_MS = 45000
const CRON_BATCH = 10
const COLUMNS =
  'id, provider, user_id, external_athlete_id, api_key, access_token, refresh_token, token_expires_at, backfill_days, status, last_synced_at, last_attempt_at, backfill_cursor, backfill_complete, backfill_imported'
const CREDENTIAL_COLUMN = { intervals: 'api_key,access_token', strava: 'refresh_token', wahoo: 'refresh_token' }

// Absolute /api/analyze URL on this deployment (a background job has no browser origin).
export function makeAnalyzeFit(req) {
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

/** Constant-time check of a shared token against a public.sync_settings row. */
export async function matchesSetting(service, key, token) {
  if (!token) return false
  const { data } = await service.from('sync_settings').select('value').eq('key', key).maybeSingle()
  if (!data?.value) return false
  const a = Buffer.from(token)
  const b = Buffer.from(data.value)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const isCronToken = (service, token) => matchesSetting(service, 'cron_token', token)

// Marks connections as attempted so overlapping runs/manual syncs don't pick them up again.
export async function claim(service, rows) {
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

// Starts the next run right away (fire and forget): the request is sent before this response ends and the new
// invocation runs on its own. The 15-minute cron stays the safety net if a link of the chain is lost.
async function triggerNextRun(req, provider, token, body, depth) {
  const run = fetch(`${appOrigin(req)}/api/sync/${provider}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
    body: JSON.stringify({ ...body, chain: depth + 1 }),
  }).catch(() => null)
  await Promise.race([run, new Promise((r) => setTimeout(r, 1500))])
}

async function finishRun({ req, service, provider, results, budget, depth, token, body }) {
  await budget?.flush()
  const chain = shouldChain({
    results,
    depth,
    provider,
    budgetLeft: budget ? budget.canSpend('backfill', 5) : true,
  })
  if (chain && token) await triggerNextRun(req, provider, token, body, depth)
  return chain
}

export async function handleSyncRequest(req, provider) {
  try {
    const service = getServiceClient()
    if (!service) {
      return NextResponse.json({ error: 'Background sync is not configured on this deployment.' }, { status: 503 })
    }
    if (provider === 'strava' && !(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET)) {
      return NextResponse.json({ error: 'Strava is not configured on this deployment.' }, { status: 503 })
    }
    if (provider === 'wahoo' && !(process.env.WAHOO_CLIENT_ID && process.env.WAHOO_CLIENT_SECRET)) {
      return NextResponse.json({ error: 'Wahoo is not configured on this deployment.' }, { status: 503 })
    }
    const credentialColumn = CREDENTIAL_COLUMN[provider]
    const deadline = Date.now() + TIME_BUDGET_MS
    const deps = { analyzeFit: makeAnalyzeFit(req), deadline }

    const token = req.headers.get('x-sync-token')
    if (token) {
      if (!(await isCronToken(service, token))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Webhooks target one rider: { userId } restricts the run to that user's connection.
      const body = await req.json().catch(() => ({}))
      const depth = Math.min(Math.max(Number.isInteger(body?.chain) ? body.chain : 0, 0), MAX_CHAIN_DEPTH)
      const budget = provider === 'strava' ? await loadStravaBudget(service) : null
      if (budget && !budget.canSpend('live', 2)) {
        return NextResponse.json({ success: true, connections: 0, results: [], budget: 'exhausted' })
      }
      deps.budget = budget
      let query = service
        .from('connections')
        .select(COLUMNS)
        .eq('provider', provider)
        .eq('status', 'active')
        .or(credentialColumn.split(',').map((c) => `${c}.not.is.null`).join(','))
      if (typeof body?.userId === 'string') query = query.eq('user_id', body.userId)
      const { data, error } = await query
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .limit(100)
      if (error) throw error
      const minIntervalS = depth > 0 ? CHAIN_MIN_INTERVAL_S : CRON_MIN_INTERVAL_S
      const due = await claim(service, pickDueConnections(data, { limit: CRON_BATCH, minIntervalS }))
      const results = await runIntervalsSync(service, due, deps)
      const chained = await finishRun({
        req, service, provider, results, budget, depth, token,
        body: typeof body?.userId === 'string' ? { userId: body.userId } : {},
      })
      return NextResponse.json({ success: true, connections: results.length, chained, results: results.map(({ userId, ...r }) => r) })
    }

    const { user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: row, error } = await service
      .from('connections')
      .select(COLUMNS)
      .eq('user_id', user.id)
      .eq('provider', provider)
      .maybeSingle()
    if (error) throw error
    if (!row || row.status === 'disconnected' || !credentialColumn.split(',').some((c) => row[c])) {
      return NextResponse.json({ error: `${PROVIDER_LABELS[provider]} is not connected.` }, { status: 400 })
    }
    const wait = manualCooldownRemaining(row.last_attempt_at)
    if (wait > 0) {
      return NextResponse.json({ error: `Please wait ${wait}s before syncing again.`, retryAfter: wait }, { status: 429 })
    }
    const budget = provider === 'strava' ? await loadStravaBudget(service) : null
    if (budget && !budget.canSpend('live', 2)) {
      return NextResponse.json(
        { error: 'Strava request budget is used up for now. Syncing resumes automatically.', retryAfter: 60 },
        { status: 429 }
      )
    }
    deps.budget = budget
    const [claimed] = await claim(service, [row])
    if (!claimed) {
      return NextResponse.json({ error: 'A sync is already running.' }, { status: 429 })
    }
    const results = await runIntervalsSync(service, [claimed], deps)
    const [result] = results
    // Continue a long backfill in the background so "Sync now" starts it instead of doing one slice.
    const cronToken = results[0]?.more ? await getSetting(service, 'cron_token') : null
    await finishRun({ req, service, provider, results, budget, depth: 0, token: cronToken, body: { userId: user.id } })
    const { userId, ...rest } = result
    return NextResponse.json({ success: !rest.error, ...rest })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Sync failed' }, { status: 500 })
  }
}
