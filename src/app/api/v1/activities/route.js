import { authenticatePartner, apiError, apiJson } from '../../../../lib/server/partnerApi'
import { readUploadRequest, processUpload } from '../../../../lib/server/partnerUploads'
import { makeAnalyzeFit } from '../../../../lib/server/syncRoute'
import { UploadValidationError, uploadView } from '../../../../lib/partnerUpload'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/v1/activities - scope activities:write. JSON streams or multipart (.fit/.tcx/.gpx).
// 201 = imported, 200 = same external_id uploaded before (or an overlapping ride exists), 422 = could not be imported.
export async function POST(req) {
  const { auth, service, response } = await authenticatePartner(req, 'activities:write')
  if (response) return response
  try {
    const request = await readUploadRequest(req)
    const { replay, row } = await processUpload({ service, auth, request, analyzeFit: makeAnalyzeFit(req) })
    const status = replay || row.status === 'duplicate' ? 200 : row.status === 'completed' ? 201 : row.status === 'failed' ? 422 : 202
    return apiJson(uploadView(row), status, { Location: `/api/v1/uploads/${row.id}` })
  } catch (err) {
    if (err instanceof UploadValidationError) return apiError(err.status, err.code, err.message)
    console.warn('Partner upload error:', err?.message)
    return apiError(500, 'server_error', 'Upload could not be processed')
  }
}
