import { NextResponse } from 'next/server'
import { createPartnerStore } from '../../../../lib/server/partnerOAuthStore'
import { handleRevokeRequest, parseBasic } from '../../../../lib/server/partnerOAuthFlow'

export const dynamic = 'force-dynamic'

export async function POST(req) {
  const store = createPartnerStore()
  if (!store) return NextResponse.json({ error: 'server_error' }, { status: 503 })
  const ct = req.headers.get('content-type') || ''
  const params = ct.includes('json') ? await req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await req.text()))
  const r = await handleRevokeRequest(store, { params, basic: parseBasic(req.headers.get('authorization')) })
  return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
}
