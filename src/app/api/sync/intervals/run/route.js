import { handleSyncRequest } from '../../../../../lib/server/syncRoute'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export const POST = (req) => handleSyncRequest(req, 'intervals')
