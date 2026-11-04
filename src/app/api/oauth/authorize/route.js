import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { createPartnerStore } from '../../../../lib/server/partnerOAuthStore'
import { validateAuthorizeRequest, approveAuthorization, denyAuthorization } from '../../../../lib/server/partnerOAuthFlow'
import { SCOPE_LABELS, buildRedirect } from '../../../../lib/partnerOAuth'

export const dynamic = 'force-dynamic'

const QUERY_KEYS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']
const pick = (src) => Object.fromEntries(QUERY_KEYS.map((k) => [k, src?.[k] == null ? undefined : String(src[k])]))
const notConfigured = () => NextResponse.json({ error: 'Partner apps are not available on this deployment.' }, { status: 503 })

// Consent page data: which app asks for which scopes. Never redirects (the redirect URI is validated first).
export async function GET(req) {
  const store = createPartnerStore()
  if (!store) return notConfigured()
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = pick(Object.fromEntries(new URL(req.url).searchParams))
  const v = await validateAuthorizeRequest(store, q)
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 })
  if (v.redirectError) return NextResponse.json({ redirect: buildRedirect(q.redirect_uri, { error: v.redirectError.error, error_description: v.redirectError.description, state: q.state }) })
  return NextResponse.json({
    app: { name: v.app.name, description: v.app.description, homepage_url: v.app.homepage_url, logo_url: v.app.logo_url },
    scopes: v.scopes.map((s) => ({ scope: s, label: SCOPE_LABELS[s] })),
  })
}

// The rider decides. Body: the same OAuth query params plus { approve: boolean }. Returns { redirect }.
export async function POST(req) {
  const store = createPartnerStore()
  if (!store) return notConfigured()
  const { user } = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const query = pick(body)
  if (body.approve === false) {
    const v = await validateAuthorizeRequest(store, query)
    if (v.error) return NextResponse.json({ error: v.error }, { status: 400 })
    return NextResponse.json(denyAuthorization(query))
  }
  const r = await approveAuthorization(store, { userId: user.id, query })
  return NextResponse.json(r, { status: r.error ? 400 : 200 })
}
