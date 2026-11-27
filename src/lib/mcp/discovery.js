// OAuth discovery documents for the MCP connector (docs/mcp.md). Pure: the origin is passed in.
//  * RFC 9728 protected resource metadata for /api/mcp
//  * RFC 8414 authorization server metadata for our existing OAuth provider (docs/partner-api.md)

import { PARTNER_SCOPES } from '../partnerScopes.js'

export const MCP_PATH = '/api/mcp'
/** Scopes the MCP tools use. Claude requests exactly these (scopes_supported of the resource metadata). */
export const MCP_SCOPES = Object.freeze(['profile:read', 'plans:read', 'plans:write', 'activities:read'])

const trimOrigin = (origin) => String(origin || '').replace(/\/+$/, '')

export const resourceUrl = (origin) => `${trimOrigin(origin)}${MCP_PATH}`
export const resourceMetadataUrl = (origin) => `${trimOrigin(origin)}/.well-known/oauth-protected-resource${MCP_PATH}`

export function protectedResourceMetadata(origin) {
  const o = trimOrigin(origin)
  return {
    resource: resourceUrl(o),
    authorization_servers: [o],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Velocity Stack',
    resource_documentation: `${o}/claude`,
  }
}

export function authorizationServerMetadata(origin) {
  const o = trimOrigin(origin)
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    // No offline_access: refresh tokens are always issued, and clients must not request unknown scopes.
    scopes_supported: [...PARTNER_SCOPES],
    // Trusted client metadata documents (Claude Code) are accepted as client_id (src/lib/cimd.js).
    client_id_metadata_document_supported: true,
    service_documentation: `${o}/developers/docs`,
  }
}

/** WWW-Authenticate value for a 401/403 from /api/mcp. */
export function wwwAuthenticate(origin, { error = null, scope = null, description = null } = {}) {
  const parts = [`resource_metadata="${resourceMetadataUrl(origin)}"`]
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${String(description).replace(/["\\]/g, '')}"`)
  if (scope) parts.push(`scope="${scope}"`)
  return `Bearer ${parts.join(', ')}`
}
