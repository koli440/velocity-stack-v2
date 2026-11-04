// src/lib/server/partnerApi.js
// Shared plumbing for the /api/v1 routes: bearer authentication, scope check, JSON error shape.

import { NextResponse } from 'next/server'
import { createPartnerStore } from './partnerOAuthStore.js'
import { authenticateBearer, bearerFromHeader } from './partnerOAuthFlow.js'
import { getServiceClient } from './connections.js'
import { minuteDecision, dayDecision } from '../partnerApps.js'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const apiError = (status, error, description, headers = {}) =>
  NextResponse.json({ error, error_description: description }, { status, headers: { ...NO_STORE, ...headers } })

export const apiJson = (body, status = 200, headers = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

/** @returns {Promise<{ auth: object, service: object } | { response: NextResponse }>} */
export async function authenticatePartner(req, scope) {
  const store = createPartnerStore()
  const service = getServiceClient()
  if (!store || !service) return { response: apiError(503, 'server_error', 'Partner API is not configured') }
  const auth = await authenticateBearer(store, bearerFromHeader(req.headers.get('authorization')))
  if (!auth) {
    return { response: apiError(401, 'invalid_token', 'Missing, expired or revoked access token', { 'WWW-Authenticate': 'Bearer error="invalid_token"' }) }
  }
  if (!auth.scopes?.includes(scope)) {
    return { response: apiError(403, 'insufficient_scope', `This endpoint needs the ${scope} scope`, { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` }) }
  }
  // Per-app request limit (one-minute buckets); counted before any work so abusive clients stay cheap.
  const { data: hits, error } = await service.rpc('partner_rate_hit', { p_app: auth.appId })
  if (!error && typeof hits === 'number') {
    const limit = auth.app.rate_limit_per_min ?? 60
    const d = minuteDecision(hits, limit)
    if (!d.allowed) {
      await service.from('partner_audit_log').insert({ app_id: auth.appId, user_id: auth.userId, event: 'rate_limited', metadata: { window: 'minute' } })
      return { response: apiError(429, 'rate_limited', 'Too many requests, slow down', { 'Retry-After': String(d.retryAfterS) }) }
    }
  }
  return { auth, service }
}

/** Daily upload cap per app (rolling 24 h). Returns a 429 response or null. */
export async function checkUploadQuota(service, auth) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count } = await service.from('partner_uploads').select('id', { count: 'exact', head: true }).eq('app_id', auth.appId).gte('created_at', since)
  const d = dayDecision(count || 0, auth.app.rate_limit_per_day ?? 500)
  if (d.allowed) return null
  await service.from('partner_audit_log').insert({ app_id: auth.appId, user_id: auth.userId, event: 'rate_limited', metadata: { window: 'day' } })
  return apiError(429, 'rate_limited', 'Daily upload limit reached', { 'Retry-After': String(d.retryAfterS) })
}
