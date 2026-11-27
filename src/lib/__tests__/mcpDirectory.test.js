import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { isAllowedRedirectUri } from '../partnerOAuth.js'
import { isCimdClientId, cimdAppFields, fetchCimd, newCimdApp, cimdSlug, CimdError, CIMD_REFRESH_MS } from '../cimd.js'
import { resolveClient, approveAuthorization, handleTokenRequest } from '../server/partnerOAuthFlow.js'
import { TOOLS, listTools } from '../mcp/tools.js'
import { authorizationServerMetadata, protectedResourceMetadata, MCP_SCOPES } from '../mcp/discovery.js'
import { PUBLIC_PATHS, PRIVATE_PATHS } from '../seo.js'
import { isPublicContentPath } from '../publicPaths.js'
import { llmsTxt } from '../llms.js'
import { CLAUDE_PATH, CLAUDE_TITLE, CLAUDE_DESCRIPTION } from '../publicPages.js'

const CC = 'https://claude.ai/oauth/claude-code-client-metadata'
const CC_DOC = { client_id: CC, client_name: 'Claude Code', client_uri: 'https://claude.ai', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
const verifier = 'v'.repeat(50)
const challenge = createHash('sha256').update(verifier).digest('base64url')

// ---- Loopback redirects ---------------------------------------------------------------------------

test('loopback redirect URIs match on any port, everything else stays exact', () => {
  const reg = ['http://localhost/callback', 'http://127.0.0.1/callback', 'https://claude.ai/api/mcp/auth_callback']
  assert.ok(isAllowedRedirectUri('http://localhost:53682/callback', reg))
  assert.ok(isAllowedRedirectUri('http://127.0.0.1:41234/callback', reg))
  assert.ok(isAllowedRedirectUri('http://localhost/callback', reg))
  assert.ok(!isAllowedRedirectUri('http://localhost:53682/callback/x', reg))
  assert.ok(!isAllowedRedirectUri('http://localhost:53682/callback?x=1', reg))
  assert.ok(!isAllowedRedirectUri('http://127.0.0.1:1/other', reg))
  assert.ok(!isAllowedRedirectUri('http://evil.example:80/callback', reg))
  assert.ok(!isAllowedRedirectUri('https://localhost:8443/callback', reg))
  assert.ok(!isAllowedRedirectUri('https://claude.ai:444/api/mcp/auth_callback', reg))
  assert.ok(!isAllowedRedirectUri('http://localhost:1/callback', ['https://claude.ai/api/mcp/auth_callback']))
})

// ---- CIMD -------------------------------------------------------------------------------------------

test('only https client ids on trusted hosts are CIMD clients', () => {
  assert.ok(isCimdClientId(CC))
  assert.ok(isCimdClientId('https://claude.com/oauth/x'))
  for (const bad of ['vsc_abc', 'http://claude.ai/x', 'https://claude.ai/', 'https://evil.example/x', 'https://claude.ai.evil.example/x',
    'https://claude.ai:8443/x', 'https://u:p@claude.ai/x', 'https://claude.ai/x?y=1', 'https://claude.ai/x#f', null, '']) {
    assert.ok(!isCimdClientId(bad), String(bad))
  }
})

test('metadata documents are validated', () => {
  assert.deepEqual(cimdAppFields(CC_DOC, CC), { name: 'Claude Code', homepage_url: 'https://claude.ai/', redirect_uris: CC_DOC.redirect_uris })
  assert.throws(() => cimdAppFields({ ...CC_DOC, client_id: 'https://claude.ai/other' }, CC), CimdError)
  assert.throws(() => cimdAppFields({ ...CC_DOC, redirect_uris: ['http://evil.example/cb'] }, CC), /redirect_uris/)
  assert.throws(() => cimdAppFields({ ...CC_DOC, token_endpoint_auth_method: 'client_secret_basic' }, CC), /public/)
  assert.throws(() => cimdAppFields({ ...CC_DOC, client_name: '' }, CC), /client_name/)
  assert.throws(() => cimdAppFields([], CC), CimdError)
  const row = newCimdApp(CC, cimdAppFields(CC_DOC, CC))
  assert.equal(row.owner_user_id, null)
  assert.equal(row.client_secret_hash, null)
  assert.equal(row.status, 'approved')
  assert.deepEqual(row.scopes, [...MCP_SCOPES])
  assert.match(row.slug, /^[a-z0-9][a-z0-9-]{1,38}$/)
  assert.equal(cimdSlug(CC), row.slug)
})

test('fetchCimd refuses untrusted URLs, redirects, big or broken documents', async () => {
  const ok = async (url, opts) => {
    assert.equal(opts.redirect, 'error')
    return { ok: true, status: 200, text: async () => JSON.stringify(CC_DOC) }
  }
  assert.equal((await fetchCimd(CC, { fetchImpl: ok })).name, 'Claude Code')
  let called = false
  await assert.rejects(fetchCimd('https://evil.example/x', { fetchImpl: async () => { called = true } }), CimdError)
  assert.equal(called, false)
  await assert.rejects(fetchCimd(CC, { fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) }), /404/)
  await assert.rejects(fetchCimd(CC, { fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(20000) }) }), /too large/)
  await assert.rejects(fetchCimd(CC, { fetchImpl: async () => ({ ok: true, text: async () => '<html>' }) }), /not JSON/)
  await assert.rejects(fetchCimd(CC, { fetchImpl: async () => { throw new TypeError('redirect') } }), /could not be fetched/)
})

function cimdStore({ existing = null, fetchFails = false } = {}) {
  const apps = existing ? [existing] : []
  const codes = new Map(); const grants = []; const log = []; let fetches = 0
  return {
    apps, log, grants, get fetches() { return fetches },
    getAppByClientId: async (id) => apps.find((a) => a.client_id === id) || null,
    getAppById: async (id) => apps.find((a) => a.id === id) || null,
    fetchCimd: async (id) => { fetches++; if (fetchFails) throw new CimdError('down'); return cimdAppFields(CC_DOC, id) },
    insertCimdApp: async (row) => { apps.push({ id: `app${apps.length + 1}`, ...row }) },
    updateCimdApp: async (id, f) => Object.assign(apps.find((a) => a.id === id), f),
    saveCode: async (r) => { codes.set(r.code_hash, { ...r, used_at: null }) },
    consumeCode: async (h) => { const c = codes.get(h); if (!c || c.used_at) return null; c.used_at = 'x'; return c },
    saveGrant: async (r) => { grants.push({ id: `g${grants.length}`, rotated_at: null, revoked_at: null, ...r }) },
    getGrantByRefresh: async () => null,
    getGrantByAccess: async () => null,
    audit: async (r) => { log.push(r.event) },
  }
}

test('a trusted CIMD client is created on first use and refreshed at most daily', async () => {
  const store = cimdStore()
  const app = await resolveClient(store, CC)
  assert.equal(app.name, 'Claude Code')
  assert.equal(store.apps.length, 1)
  assert.deepEqual(store.log, ['cimd_registered'])
  await resolveClient(store, CC)
  assert.equal(store.fetches, 1, 'cached for a day')
  await resolveClient(store, CC, { now: Date.now() + CIMD_REFRESH_MS + 1000 })
  assert.equal(store.fetches, 2)
  assert.equal(store.apps.length, 1)
  // An unknown, untrusted URL is never fetched and does not exist.
  assert.equal(await resolveClient(store, 'https://evil.example/meta'), null)
  assert.equal(store.fetches, 2)
})

test('a suspended CIMD client stays suspended; a failed fetch keeps the stored row', async () => {
  const suspended = { id: 'a1', client_id: CC, owner_user_id: null, status: 'suspended', redirect_uris: CC_DOC.redirect_uris, scopes: MCP_SCOPES, cimd_fetched_at: '2000-01-01T00:00:00Z' }
  const store = cimdStore({ existing: suspended, fetchFails: true })
  assert.equal((await resolveClient(store, CC)).status, 'suspended')
  const store2 = cimdStore({ existing: { ...suspended, cimd_fetched_at: '2000-01-01T00:00:00Z' } })
  assert.equal((await resolveClient(store2, CC)).status, 'suspended')
  assert.equal(await resolveClient(cimdStore({ fetchFails: true }), CC), null)
})

test('Claude Code can sign in end to end: loopback port, PKCE, public client', async () => {
  const store = cimdStore()
  const query = { client_id: CC, redirect_uri: 'http://127.0.0.1:50123/callback', response_type: 'code', state: 's', code_challenge: challenge, code_challenge_method: 'S256', scope: MCP_SCOPES.join(' ') }
  const r = await approveAuthorization(store, { userId: 'u1', query })
  const url = new URL(r.redirect)
  assert.equal(url.port, '50123')
  const code = url.searchParams.get('code')
  assert.ok(code)
  const t = await handleTokenRequest(store, { params: { grant_type: 'authorization_code', client_id: CC, code, redirect_uri: query.redirect_uri, code_verifier: verifier } })
  assert.equal(t.status, 200)
  assert.equal(t.body.scope, MCP_SCOPES.join(' '))
  // A scope the CIMD client was not given is refused.
  const bad = await approveAuthorization(store, { userId: 'u1', query: { ...query, scope: 'activities:write' } })
  assert.equal(new URL(bad.redirect).searchParams.get('error'), 'invalid_scope')
})

test('authorization server metadata advertises CIMD', () => {
  const as = authorizationServerMetadata('https://www.velocity-stack.app')
  assert.equal(as.client_id_metadata_document_supported, true)
  assert.ok(as.token_endpoint_auth_methods_supported.includes('none'))
  assert.equal(protectedResourceMetadata('https://www.velocity-stack.app').resource_documentation, 'https://www.velocity-stack.app/claude')
})

// ---- Tool annotations (directory review rules) ----------------------------------------------------

test('every tool has a title, and read / destructive hints match what it does', () => {
  for (const t of listTools(MCP_SCOPES, { macro_planner: true })) {
    assert.ok(t.title && t.annotations.title, t.name)
    assert.ok(t.name.length <= 64, t.name)
    const tool = TOOLS[t.name]
    if (tool.write) {
      assert.equal(t.annotations.readOnlyHint, false, t.name)
      assert.equal(t.annotations.destructiveHint, true, t.name)
    } else {
      assert.equal(t.annotations.readOnlyHint, true, t.name)
    }
  }
})

// ---- Per-rider rate limit and public help page ------------------------------------------------------

test('the MCP route limits per rider, not per app', () => {
  const route = fs.readFileSync('src/app/api/mcp/route.js', 'utf8')
  assert.match(route, /partner_user_rate_hit/)
  assert.match(route, /rate_limit_per_user_min/)
  assert.ok(!/'partner_rate_hit'/.test(route))
  const sql = fs.readFileSync('supabase/migrations/20270192000000_mcp_directory.sql', 'utf8')
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.partner_user_rate_hit\(UUID, UUID, INTEGER\) FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.partner_user_rate_hit\(UUID, UUID, INTEGER\) TO service_role;/)
})

test('the /claude help page is public, indexable and linked', () => {
  assert.ok(PUBLIC_PATHS.includes(CLAUDE_PATH))
  assert.ok(isPublicContentPath(CLAUDE_PATH))
  assert.ok(!PRIVATE_PATHS.some((x) => CLAUDE_PATH.startsWith(x)))
  assert.ok(llmsTxt([], []).includes(`https://velocity-stack.app${CLAUDE_PATH}`))
  assert.ok(fs.readFileSync('src/app/sitemap.js', 'utf8').includes(`'${CLAUDE_PATH}'`))
  assert.ok(fs.readFileSync('src/components/Footer.js', 'utf8').includes(`href="${CLAUDE_PATH}"`))
  assert.ok(CLAUDE_TITLE.length <= 45 && CLAUDE_DESCRIPTION.length <= 155)
  const page = fs.readFileSync('src/app/claude/page.js', 'utf8')
  for (const name of Object.keys(TOOLS)) assert.ok(page.includes(`'${name}'`), name)
  assert.ok(page.includes('/privacy'))
})
