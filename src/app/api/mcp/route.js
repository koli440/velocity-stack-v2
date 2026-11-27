import { NextResponse } from 'next/server'
import { createPartnerStore } from '../../../lib/server/partnerOAuthStore'
import { authenticateBearer, bearerFromHeader } from '../../../lib/server/partnerOAuthFlow'
import { getServiceClient } from '../../../lib/server/connections'
import { appOrigin } from '../../../lib/server/appUrl'
import { createMcpData } from '../../../lib/server/mcpData'
import { hashToken } from '../../../lib/partnerOAuth'
import { minuteDecision } from '../../../lib/partnerApps'
import { handlePost, countToolCalls, RPC_ERRORS } from '../../../lib/mcp/protocol'
import { listTools, callTool } from '../../../lib/mcp/tools'
import { wwwAuthenticate } from '../../../lib/mcp/discovery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }
const NO_CAPS = { athletes: [], macro_planner: false, has_macro_plan: false }
const CAPS_TOOLS = new Set(['get_athlete', 'get_macro_plan'])

const rpcErrorResponse = (status, code, message, headers = {}) =>
  NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } })

// POST /api/mcp - MCP Streamable HTTP (stateless, JSON responses). Bearer = access token of our OAuth provider.
// See docs/mcp.md.
export async function POST(req) {
  const store = createPartnerStore()
  const service = getServiceClient()
  if (!store || !service) return rpcErrorResponse(503, RPC_ERRORS.INTERNAL, 'MCP is not configured on this deployment')
  const origin = appOrigin(req)

  const token = bearerFromHeader(req.headers.get('authorization'))
  const auth = token ? await authenticateBearer(store, token) : null
  if (!auth) {
    const header = wwwAuthenticate(origin, token ? { error: 'invalid_token', description: 'Missing, expired or revoked access token' } : {})
    return NextResponse.json({ error: 'invalid_token', error_description: 'Authorization required' }, { status: 401, headers: { ...NO_STORE, 'WWW-Authenticate': header } })
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return rpcErrorResponse(400, RPC_ERRORS.PARSE, 'Parse error')
  }

  // Per-app request limit (same counter as the partner API), counted only for tool calls.
  const calls = countToolCalls(payload)
  if (calls > 0) {
    let hits = null
    for (let i = 0; i < calls; i++) {
      const { data, error } = await service.rpc('partner_rate_hit', { p_app: auth.appId })
      if (error || typeof data !== 'number') break
      hits = data
    }
    if (hits != null) {
      const d = minuteDecision(hits, auth.app.rate_limit_per_min ?? 60)
      if (!d.allowed) {
        await service.from('partner_audit_log').insert({ app_id: auth.appId, user_id: auth.userId, event: 'rate_limited', metadata: { window: 'minute', via: 'mcp' } })
        return rpcErrorResponse(429, RPC_ERRORS.INTERNAL, 'Too many requests, slow down', { 'Retry-After': String(d.retryAfterS) })
      }
    }
  }

  const data = createMcpData({ service, tokenHash: hashToken(token), userId: auth.userId })
  let capsPromise = null
  const caps = () => (capsPromise ||= data.capabilities().catch(() => NO_CAPS))
  const onWrite = async (tool) => {
    const { error } = await service.from('partner_audit_log').insert({ app_id: auth.appId, user_id: auth.userId, event: 'mcp_write', metadata: { tool } })
    if (error) console.warn('mcp audit failed:', error.message)
  }
  const server = {
    listTools: async () => listTools(auth.scopes, await caps()),
    callTool: async (name, args) => callTool(name, args, { scopes: auth.scopes, data, caps: CAPS_TOOLS.has(name) ? await caps() : NO_CAPS, onWrite }),
  }

  const r = await handlePost(payload, server)
  if (r.status === 202) return new Response(null, { status: 202, headers: NO_STORE })
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE })
}

// No server-initiated stream (stateless server): GET and DELETE are not offered.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST', ...NO_STORE } })
export const GET = notAllowed
export const DELETE = notAllowed
