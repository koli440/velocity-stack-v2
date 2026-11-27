// Minimal, stateless MCP server core (Streamable HTTP, JSON responses; docs/mcp.md). Pure: no I/O of its own.
// Methods: initialize, ping, tools/list, tools/call; notifications are accepted (no response).

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
export const SERVER_INFO = Object.freeze({ name: 'velocity-stack', title: 'Velocity Stack', version: '1.0.0' })

export const INSTRUCTIONS = [
  'Velocity Stack is a cycling training platform. Tools act on the signed-in athlete\'s own account.',
  'Plan workouts with create_planned_workout; give an interval structure in the Velocity Stack interval DSL',
  '(e.g. "warmup 15min\\n4x\\nwork 8min @ 95-105%FTP\\nrecovery 4min @ <55%FTP\\ncooldown 10min") so the workout is pushed to',
  'Garmin / Wahoo / Intervals.icu when the athlete enabled that. Dates are calendar days (YYYY-MM-DD).',
  'estimated_load of a planned workout is the same "~TL" estimate the calendar shows.',
  'Races (goals; priority A = main goal) are managed with list_races / create_race / update_race / delete_race,',
  'day notes (sickness, travel, availability) with list_notes / create_note / update_note / delete_note.',
  'Evaluate training with list_activities, get_activity, run_template and get_fitness (fitness = CTL, fatigue = ATL, form = TSB).',
  'Coaches can pass athlete_id (see get_athlete -> coached_athletes) to plan in an athlete\'s calendar.',
].join(' ')

export const RPC_ERRORS = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 })

const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } })
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })

export function negotiateVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION
}

const isRequest = (m) => m && typeof m === 'object' && m.jsonrpc === '2.0' && typeof m.method === 'string'
const isNotification = (m) => isRequest(m) && !('id' in m)

/**
 * Handles one JSON-RPC message. Returns a response object, or null for notifications / responses.
 * `server`: { listTools(): Promise<Tool[]>, callTool(name, args): Promise<CallToolResult> }.
 */
export async function handleMessage(msg, server) {
  if (!isRequest(msg)) {
    // Responses from the client (we never send requests) are ignored; anything else is invalid.
    if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return null
    return rpcError(msg?.id, RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request')
  }
  if (isNotification(msg)) return null
  const { id, method, params = {} } = msg
  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: negotiateVersion(params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { ...SERVER_INFO },
          instructions: INSTRUCTIONS,
        })
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, { tools: await server.listTools() })
      case 'tools/call': {
        if (!params || typeof params.name !== 'string') return rpcError(id, RPC_ERRORS.INVALID_PARAMS, 'tools/call needs a tool name')
        const args = params.arguments ?? {}
        if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, RPC_ERRORS.INVALID_PARAMS, 'arguments must be an object')
        const result = await server.callTool(params.name, args)
        if (result?.unknownTool) return rpcError(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params.name}`)
        return rpcResult(id, result)
      }
      default:
        return rpcError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  } catch (err) {
    return rpcError(id, RPC_ERRORS.INTERNAL, 'Internal error')
  }
}

/**
 * Handles a POST body (one message or a batch). Returns { status, body } where body is null for 202.
 */
export async function handlePost(payload, server) {
  if (payload === undefined) return { status: 400, body: rpcError(null, RPC_ERRORS.PARSE, 'Parse error') }
  const batch = Array.isArray(payload)
  const messages = batch ? payload : [payload]
  if (messages.length === 0 || messages.length > 20) return { status: 400, body: rpcError(null, RPC_ERRORS.INVALID_REQUEST, 'Invalid batch') }
  const out = []
  for (const m of messages) {
    const r = await handleMessage(m, server)
    if (r) out.push(r)
  }
  if (out.length === 0) return { status: 202, body: null }
  return { status: 200, body: batch ? out : out[0] }
}

/** Methods in this payload that need tool access (and count against the rate limit). */
export function countToolCalls(payload) {
  const list = Array.isArray(payload) ? payload : [payload]
  return list.filter((m) => isRequest(m) && m.method === 'tools/call').length
}

export const textResult = (value, { isError = false } = {}) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(typeof value === 'object' && value !== null && !Array.isArray(value) && !isError ? { structuredContent: value } : {}),
  ...(isError ? { isError: true } : {}),
})
