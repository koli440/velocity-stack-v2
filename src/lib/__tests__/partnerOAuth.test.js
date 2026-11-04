import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { verifyPkce, isAllowedRedirectUri, resolveScopes, hashToken, buildRedirect } from '../partnerOAuth.js'
import {
  validateAuthorizeRequest, approveAuthorization, handleTokenRequest, handleRevokeRequest, authenticateBearer, parseBasic,
} from '../server/partnerOAuthFlow.js'

const verifier = 'v'.repeat(50)
const challenge = createHash('sha256').update(verifier).digest('base64url')

function memStore(appOver = {}) {
  const app = { id: 'app1', client_id: 'cid', client_secret_hash: null, status: 'approved', redirect_uris: ['https://game.example/cb'], scopes: ['activities:write', 'profile:read'], ...appOver }
  const codes = new Map(); const grants = []; const log = []
  return {
    codes, grants, log,
    getAppByClientId: async (id) => (id === app.client_id ? app : null),
    getAppById: async (id) => (id === app.id ? app : null),
    saveCode: async (r) => { codes.set(r.code_hash, { ...r, used_at: null }) },
    consumeCode: async (h) => { const c = codes.get(h); if (!c || c.used_at) return null; c.used_at = 'x'; return c },
    saveGrant: async (r) => { grants.push({ id: `g${grants.length}`, rotated_at: null, revoked_at: null, ...r }) },
    getGrantByRefresh: async (h) => grants.find((g) => g.refresh_token_hash === h) || null,
    getGrantByAccess: async (h) => grants.find((g) => g.access_token_hash === h) || null,
    markRotated: async (id) => { const g = grants.find((x) => x.id === id); if (g.rotated_at) return false; g.rotated_at = 'x'; return true },
    revokeFamily: async (f) => { grants.filter((g) => g.family_id === f).forEach((g) => { g.revoked_at = 'x' }) },
    touchGrant: async () => {},
    audit: async (r) => { log.push(r.event) },
  }
}
const query = { client_id: 'cid', redirect_uri: 'https://game.example/cb', response_type: 'code', state: 's1', code_challenge: challenge, code_challenge_method: 'S256', scope: 'activities:write' }

async function getCode(store) {
  const r = await approveAuthorization(store, { userId: 'u1', query })
  return new URL(r.redirect).searchParams
}
const exchange = (store, code, extra = {}) => handleTokenRequest(store, { params: { grant_type: 'authorization_code', client_id: 'cid', code, redirect_uri: query.redirect_uri, code_verifier: verifier, ...extra } })

test('helpers: PKCE, redirect matching, scopes, hashing', () => {
  assert.ok(verifyPkce(verifier, challenge))
  assert.ok(!verifyPkce('short', challenge))
  assert.ok(!verifyPkce('w'.repeat(50), challenge))
  assert.ok(isAllowedRedirectUri('https://a.example/cb', ['https://a.example/cb']))
  assert.ok(!isAllowedRedirectUri('https://a.example/cb/x', ['https://a.example/cb']))
  assert.ok(!isAllowedRedirectUri('http://a.example/cb', ['http://a.example/cb']))
  assert.ok(isAllowedRedirectUri('http://localhost:3000/cb', ['http://localhost:3000/cb']))
  assert.deepEqual(resolveScopes('', ['activities:write']), ['activities:write'])
  assert.equal(resolveScopes('admin', ['activities:write']), null)
  assert.equal(resolveScopes('profile:read', ['activities:write']), null)
  assert.notEqual(hashToken('a'), 'a')
  assert.equal(buildRedirect('https://a.example/cb?x=1', { code: 'c', state: undefined }), 'https://a.example/cb?x=1&code=c')
})

test('authorize validation: unknown app, bad redirect, missing PKCE/state', async () => {
  const s = memStore()
  assert.ok((await validateAuthorizeRequest(s, { ...query, client_id: 'nope' })).error)
  assert.ok((await validateAuthorizeRequest(memStore({ status: 'pending' }), query)).error)
  assert.ok((await validateAuthorizeRequest(s, { ...query, redirect_uri: 'https://evil.example/cb' })).error)
  assert.equal((await validateAuthorizeRequest(s, { ...query, code_challenge_method: 'plain' })).redirectError.error, 'invalid_request')
  assert.equal((await validateAuthorizeRequest(s, { ...query, state: undefined })).redirectError.error, 'invalid_request')
  assert.equal((await validateAuthorizeRequest(s, { ...query, scope: 'nope' })).redirectError.error, 'invalid_scope')
  assert.deepEqual((await validateAuthorizeRequest(s, query)).scopes, ['activities:write'])
})

test('code flow: exchange once with PKCE, then reuse fails', async () => {
  const s = memStore()
  const p = await getCode(s)
  assert.equal(p.get('state'), 's1')
  const bad = await exchange(s, p.get('code'), { code_verifier: 'x'.repeat(50) })
  assert.equal(bad.status, 400)
  const s2 = memStore()
  const p2 = await getCode(s2)
  const ok = await exchange(s2, p2.get('code'))
  assert.equal(ok.status, 200)
  assert.equal(ok.body.token_type, 'Bearer')
  assert.ok(ok.body.refresh_token && ok.body.access_token)
  assert.notEqual(s2.grants[0].access_token_hash, ok.body.access_token)
  assert.equal((await exchange(s2, p2.get('code'))).body.error, 'invalid_grant')
  assert.equal((await exchange(memStore(), 'garbage')).body.error, 'invalid_grant')
})

test('code is bound to redirect_uri and expires', async () => {
  const s = memStore()
  const p = await getCode(s)
  assert.equal((await exchange(s, p.get('code'), { redirect_uri: 'https://game.example/other' })).body.error, 'invalid_grant')
  const s2 = memStore()
  const p2 = await getCode(s2)
  const r = await handleTokenRequest(s2, { params: { grant_type: 'authorization_code', client_id: 'cid', code: p2.get('code'), redirect_uri: query.redirect_uri, code_verifier: verifier }, now: Date.now() + 11 * 60 * 1000 })
  assert.equal(r.body.error, 'invalid_grant')
})

test('confidential client needs the secret; basic auth parsed', async () => {
  const s = memStore({ client_secret_hash: hashToken('sekret') })
  const p = await getCode(s)
  assert.equal((await exchange(s, p.get('code'))).status, 401)
  const p2 = await getCode(s)
  const ok = await handleTokenRequest(s, { params: { grant_type: 'authorization_code', code: p2.get('code'), redirect_uri: query.redirect_uri, code_verifier: verifier }, basic: parseBasic(`Basic ${Buffer.from('cid:sekret').toString('base64')}`) })
  assert.equal(ok.status, 200)
})

test('refresh rotates; reusing an old refresh token revokes the family', async () => {
  const s = memStore()
  const first = (await exchange(s, (await getCode(s)).get('code'))).body
  const refresh = (rt) => handleTokenRequest(s, { params: { grant_type: 'refresh_token', client_id: 'cid', refresh_token: rt } })
  const second = await refresh(first.refresh_token)
  assert.equal(second.status, 200)
  assert.notEqual(second.body.refresh_token, first.refresh_token)
  assert.equal(await authenticateBearer(s, first.access_token), null)
  assert.equal((await authenticateBearer(s, second.body.access_token)).userId, 'u1')
  assert.equal((await refresh(first.refresh_token)).body.error, 'invalid_grant')
  assert.equal(await authenticateBearer(s, second.body.access_token), null)
  assert.ok(s.log.includes('refresh_reuse'))
})

test('revoke kills the grant; suspended apps and expired tokens are rejected', async () => {
  const s = memStore()
  const t = (await exchange(s, (await getCode(s)).get('code'))).body
  assert.ok(await authenticateBearer(s, t.access_token))
  assert.equal(await authenticateBearer(s, t.access_token, { now: Date.now() + 2 * 3600 * 1000 }), null)
  assert.equal((await handleRevokeRequest(s, { params: { client_id: 'cid', token: 'unknown' } })).status, 200)
  assert.equal((await handleRevokeRequest(s, { params: { client_id: 'cid', token: t.refresh_token } })).status, 200)
  assert.equal(await authenticateBearer(s, t.access_token), null)
  const s2 = memStore()
  const t2 = (await exchange(s2, (await getCode(s2)).get('code'))).body
  const app = await s2.getAppById('app1'); app.status = 'suspended'
  assert.equal(await authenticateBearer(s2, t2.access_token), null)
})
