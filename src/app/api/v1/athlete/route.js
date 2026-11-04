import { authenticatePartner, apiJson } from '../../../../lib/server/partnerApi'

export const dynamic = 'force-dynamic'

// GET /api/v1/athlete - scope profile:read. Minimal profile for tuning in-app power targets: FTP and weight.
export async function GET(req) {
  const { auth, service, response } = await authenticatePartner(req, 'profile:read')
  if (response) return response
  const [{ data: profile }, { data: weights }] = await Promise.all([
    service.from('profiles').select('ftp_w').eq('id', auth.userId).maybeSingle(),
    service.from('weight_history').select('weight_kg').eq('user_id', auth.userId).order('effective_from', { ascending: false }).limit(1),
  ])
  return apiJson({ ftp_w: profile?.ftp_w ?? null, weight_kg: weights?.[0]?.weight_kg ?? null })
}
