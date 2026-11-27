// OAuth Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document) for the partner OAuth
// provider (docs/mcp.md). A client may use an https URL as its client_id; the document at that URL describes it.
// Only documents on TRUSTED hosts are accepted (Claude Code: https://claude.ai/oauth/claude-code-client-metadata),
// so the server never fetches arbitrary URLs. Such clients are public (PKCE only) and get the MCP scopes.

import { createHash } from 'node:crypto'
import { isValidRedirectUri } from './partnerOAuth.js'
import { MCP_SCOPES } from './mcp/discovery.js'

export const CIMD_TRUSTED_HOSTS = Object.freeze(['claude.ai', 'claude.com'])
export const CIMD_REFRESH_MS = 24 * 3600 * 1000
export const CIMD_MAX_BYTES = 10 * 1024
export const CIMD_TIMEOUT_MS = 5000

export class CimdError extends Error {}

/** True for an https client_id URL with a path on a trusted host (no credentials, port, query or fragment). */
export function isCimdClientId(id) {
  let u
  try {
    u = new URL(String(id ?? ''))
  } catch {
    return false
  }
  return (
    u.protocol === 'https:' && CIMD_TRUSTED_HOSTS.includes(u.hostname) && !u.port && !u.username && !u.password &&
    !u.search && !u.hash && u.pathname.length > 1 && u.toString() === String(id)
  )
}

/** Validates a fetched document; returns the developer_apps fields or throws CimdError. */
export function cimdAppFields(doc, clientId) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CimdError('Client metadata is not a JSON object')
  if (doc.client_id !== clientId) throw new CimdError('client_id in the metadata does not match')
  const name = String(doc.client_name ?? '').trim().slice(0, 80)
  if (name.length < 2) throw new CimdError('Client metadata has no client_name')
  const uris = Array.isArray(doc.redirect_uris) ? [...new Set(doc.redirect_uris.map(String))] : []
  if (!uris.length || uris.length > 10 || !uris.every(isValidRedirectUri)) throw new CimdError('Client metadata has invalid redirect_uris')
  const method = doc.token_endpoint_auth_method ?? 'none'
  if (method !== 'none') throw new CimdError('Only public clients (token_endpoint_auth_method none) are supported')
  if (doc.grant_types && !(Array.isArray(doc.grant_types) && doc.grant_types.includes('authorization_code'))) {
    throw new CimdError('Client metadata does not allow authorization_code')
  }
  let homepage = null
  try {
    const h = new URL(String(doc.client_uri ?? ''))
    if (h.protocol === 'https:') homepage = h.toString()
  } catch {}
  return { name, homepage_url: homepage, redirect_uris: uris }
}

/** Stable slug for a CIMD client (developer_apps.slug is unique, ^[a-z0-9][a-z0-9-]{1,38}$). */
export const cimdSlug = (clientId) => `cimd-${createHash('sha256').update(clientId).digest('hex').slice(0, 12)}`

/** Fields of a new developer_apps row for a CIMD client. */
export const newCimdApp = (clientId, fields, now = new Date()) => ({
  owner_user_id: null,
  client_id: clientId,
  client_secret_hash: null,
  slug: cimdSlug(clientId),
  name: fields.name,
  description: `Signs in with its client metadata document (${new URL(clientId).hostname}).`,
  homepage_url: fields.homepage_url,
  redirect_uris: fields.redirect_uris,
  scopes: [...MCP_SCOPES],
  status: 'approved',
  cimd_fetched_at: now.toISOString(),
})

/** Fetches and validates the metadata document (trusted hosts only, no redirects, size and time capped). */
export async function fetchCimd(clientId, { fetchImpl = fetch, timeoutMs = CIMD_TIMEOUT_MS } = {}) {
  if (!isCimdClientId(clientId)) throw new CimdError('Untrusted client metadata URL')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(clientId, { redirect: 'error', signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new CimdError(`Client metadata returned HTTP ${res.status}`)
    const text = await res.text()
    if (text.length > CIMD_MAX_BYTES) throw new CimdError('Client metadata is too large')
    let doc
    try {
      doc = JSON.parse(text)
    } catch {
      throw new CimdError('Client metadata is not JSON')
    }
    return cimdAppFields(doc, clientId)
  } catch (e) {
    if (e instanceof CimdError) throw e
    throw new CimdError('Client metadata could not be fetched')
  } finally {
    clearTimeout(timer)
  }
}
