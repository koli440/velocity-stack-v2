// src/lib/server/partnerApi.js
// Shared plumbing for the /api/v1 routes: bearer authentication, scope check, JSON error shape.

import { NextResponse } from 'next/server'
import { createPartnerStore } from './partnerOAuthStore.js'
import { authenticateBearer, bearerFromHeader } from './partnerOAuthFlow.js'
import { getServiceClient } from './connections.js'

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
  return { auth, service }
}
