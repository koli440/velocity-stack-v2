// src/lib/server/partnerOAuthFlow.js
//
// OAuth 2.0 provider logic (authorization code + PKCE S256, rotating refresh tokens with reuse detection,
// revocation) written against a small `store` so it is testable without a database
// (see partnerOAuthStore.js for the Supabase implementation).

import {
  CODE_TTL_S, ACCESS_TTL_S, REFRESH_TTL_S, newToken, hashToken, safeEqual, verifyPkce, isValidChallenge,
  isAllowedRedirectUri, resolveScopes, buildRedirect, oauthError,
} from '../partnerOAuth.js'

const iso = (ms) => new Date(ms).toISOString()

/** Validates an authorize request; returns { app, scopes } or { error } (never redirect on a bad client/redirect). */
export async function validateAuthorizeRequest(store, q) {
  const app = q.client_id ? await store.getAppByClientId(String(q.client_id)) : null
  if (!app || app.status !== 'approved') return { error: 'Unknown or unapproved application.' }
  if (!isAllowedRedirectUri(q.redirect_uri, app.redirect_uris)) return { error: 'Redirect URI is not registered for this application.' }
  const redirectError = (error, description) => ({ redirectError: { error, description }, app })
  if (q.response_type !== 'code') return redirectError('unsupported_response_type', 'response_type must be code')
  if (!q.state) return redirectError('invalid_request', 'state is required')
  if (q.code_challenge_method !== 'S256' || !isValidChallenge(q.code_challenge)) {
    return redirectError('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  const scopes = resolveScopes(q.scope, app.scopes)
  if (!scopes || scopes.length === 0) return redirectError('invalid_scope', 'Unknown or not permitted scope')
  return { app, scopes }
}

/** The signed-in rider approved: stores a single-use code and returns the URL to send the browser to. */
export async function approveAuthorization(store, { userId, query, now = Date.now() }) {
  const v = await validateAuthorizeRequest(store, query)
  if (v.error) return { error: v.error }
  if (v.redirectError) return { redirect: buildRedirect(query.redirect_uri, { error: v.redirectError.error, error_description: v.redirectError.description, state: query.state }) }
  const code = newToken('vsc')
  await store.saveCode({
    code_hash: hashToken(code), app_id: v.app.id, user_id: userId, redirect_uri: query.redirect_uri,
    scopes: v.scopes, code_challenge: query.code_challenge, expires_at: iso(now + CODE_TTL_S * 1000),
  })
  await store.audit({ app_id: v.app.id, user_id: userId, event: 'authorize', metadata: { scopes: v.scopes } })
  return { redirect: buildRedirect(query.redirect_uri, { code, state: query.state }) }
}

export function denyAuthorization(query) {
  return { redirect: buildRedirect(query.redirect_uri, { error: 'access_denied', state: query.state }) }
}

async function authenticateClient(store, params, basic) {
  const clientId = basic?.id || params.client_id
  const secret = basic?.secret || params.client_secret
  const app = clientId ? await store.getAppByClientId(String(clientId)) : null
  if (!app) return { fail: oauthError('invalid_client', 'Unknown client', 401) }
  // Confidential clients must present their secret; public clients rely on PKCE alone.
  if (app.client_secret_hash && !safeEqual(hashToken(secret), app.client_secret_hash)) {
    return { fail: oauthError('invalid_client', 'Bad client credentials', 401) }
  }
  if (app.status !== 'approved') return { fail: oauthError('unauthorized_client', 'Application is not approved', 403) }
  return { app }
}

const tokenBody = (access, refresh, scopes) => ({
  token_type: 'Bearer', access_token: access, expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' '),
})

async function issue(store, { app, userId, scopes, familyId, now }) {
  const access = newToken('vsa')
  const refresh = newToken('vsr')
  await store.saveGrant({
    family_id: familyId, app_id: app.id, user_id: userId, scopes,
    access_token_hash: hashToken(access), access_expires_at: iso(now + ACCESS_TTL_S * 1000),
    refresh_token_hash: hashToken(refresh), refresh_expires_at: iso(now + REFRESH_TTL_S * 1000),
  })
  return tokenBody(access, refresh, scopes)
}

/** POST /oauth/token. Returns { status, body }. */
export async function handleTokenRequest(store, { params, basic = null, now = Date.now() }) {
  const auth = await authenticateClient(store, params, basic)
  if (auth.fail) return auth.fail
  const { app } = auth

  if (params.grant_type === 'authorization_code') {
    const rec = params.code ? await store.consumeCode(hashToken(params.code)) : null
    // consumeCode is atomic: a second use of the same code returns null.
    if (!rec || rec.app_id !== app.id || Date.parse(rec.expires_at) < now) return oauthError('invalid_grant', 'Invalid or expired code')
    if (rec.redirect_uri !== params.redirect_uri) return oauthError('invalid_grant', 'redirect_uri mismatch')
    if (!verifyPkce(params.code_verifier, rec.code_challenge)) return oauthError('invalid_grant', 'PKCE verification failed')
    const body = await issue(store, { app, userId: rec.user_id, scopes: rec.scopes, familyId: crypto.randomUUID(), now })
    await store.audit({ app_id: app.id, user_id: rec.user_id, event: 'token', metadata: {} })
    return { status: 200, body }
  }

  if (params.grant_type === 'refresh_token') {
    const g = params.refresh_token ? await store.getGrantByRefresh(hashToken(params.refresh_token)) : null
    if (!g || g.app_id !== app.id) return oauthError('invalid_grant', 'Invalid refresh token')
    if (g.revoked_at || Date.parse(g.refresh_expires_at) < now) return oauthError('invalid_grant', 'Refresh token expired or revoked')
    // A rotated refresh token coming back means it leaked: kill the whole family.
    if (g.rotated_at) {
      await store.revokeFamily(g.family_id)
      await store.audit({ app_id: app.id, user_id: g.user_id, event: 'refresh_reuse', metadata: {} })
      return oauthError('invalid_grant', 'Refresh token was already used')
    }
    if (!(await store.markRotated(g.id))) return oauthError('invalid_grant', 'Refresh token was already used')
    const body = await issue(store, { app, userId: g.user_id, scopes: g.scopes, familyId: g.family_id, now })
    await store.audit({ app_id: app.id, user_id: g.user_id, event: 'refresh', metadata: {} })
    return { status: 200, body }
  }
  return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
}

/** RFC 7009: always 200 for a well-formed request, even for an unknown token. */
export async function handleRevokeRequest(store, { params, basic = null }) {
  const auth = await authenticateClient(store, params, basic)
  if (auth.fail) return auth.fail
  if (params.token) {
    const hash = hashToken(params.token)
    const g = (await store.getGrantByRefresh(hash)) || (await store.getGrantByAccess(hash))
    if (g && g.app_id === auth.app.id) {
      await store.revokeFamily(g.family_id)
      await store.audit({ app_id: auth.app.id, user_id: g.user_id, event: 'revoke', metadata: {} })
    }
  }
  return { status: 200, body: {} }
}

/** Resolves a bearer access token to { userId, appId, scopes } or null (expired/revoked/suspended app). */
export async function authenticateBearer(store, token, { now = Date.now() } = {}) {
  if (!token) return null
  const g = await store.getGrantByAccess(hashToken(token))
  if (!g || g.revoked_at || g.rotated_at || Date.parse(g.access_expires_at) < now) return null
  const app = await store.getAppById(g.app_id)
  if (!app || app.status !== 'approved') return null
  await store.touchGrant(g.id)
  return { userId: g.user_id, appId: g.app_id, scopes: g.scopes, app }
}

export const bearerFromHeader = (h) => /^Bearer\s+(\S+)$/i.exec(h || '')?.[1] || null

export function parseBasic(header) {
  const m = /^Basic\s+(\S+)$/i.exec(header || '')
  if (!m) return null
  const [id, ...rest] = Buffer.from(m[1], 'base64').toString().split(':')
  return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) } : null
}
