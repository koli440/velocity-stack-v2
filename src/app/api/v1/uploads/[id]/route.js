import { authenticatePartner, apiError, apiJson } from '../../../../../lib/server/partnerApi'
import { uploadView } from '../../../../../lib/partnerUpload'

export const dynamic = 'force-dynamic'

// GET /api/v1/uploads/{id} - status of an upload made by this app for this rider.
export async function GET(req, { params }) {
  const { auth, service, response } = await authenticatePartner(req, 'activities:write')
  if (response) return response
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return apiError(404, 'not_found', 'Upload not found')
  const { data } = await service
    .from('partner_uploads')
    .select('id, external_id, status, activity_id, error, created_at')
    .eq('id', params.id)
    .eq('app_id', auth.appId)
    .eq('user_id', auth.userId)
    .maybeSingle()
  return data ? apiJson(uploadView(data)) : apiError(404, 'not_found', 'Upload not found')
}
