import { NextResponse } from 'next/server'
import { appOrigin } from '../../../../lib/server/appUrl'
import { authorizationServerMetadata } from '../../../../lib/mcp/discovery'

export const dynamic = 'force-dynamic'

// GET /.well-known/oauth-authorization-server (also with a path suffix such as /api/mcp) - OAuth discovery for the MCP connector.
// See docs/mcp.md.
export function GET(req) {
  return NextResponse.json(authorizationServerMetadata(appOrigin(req)), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
