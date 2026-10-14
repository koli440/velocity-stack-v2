import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { getServiceClient } from '../../../../../lib/server/connections'
import { ensureStravaWebhook } from '../../../../../lib/server/stravaSetup'
import { appOrigin } from '../../../../../lib/server/appUrl'
import { isCronToken } from '../../../../../lib/server/syncRoute'
import { isStravaConfigured } from '../../../../../lib/strava'
import { ImportError } from '../../../../../lib/server/importErrors'

export const dynamic = 'force-dynamic'

// Manual fallback for the one-time webhook subscription (it is normally created when the first rider
// connects Strava). Idempotent; allowed for any signed-in user or with the sync token (x-sync-token).
export async function POST(req) {
  try {
    const service = getServiceClient()
    if (!service || !isStravaConfigured()) {
      return NextResponse.json({ error: 'Strava is not configured on this deployment.' }, { status: 503 })
    }
    const token = req.headers.get('x-sync-token')
    const allowed = token ? await isCronToken(service, token) : !!(await getRequestUser(req)).user
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await ensureStravaWebhook(service, appOrigin(req))
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const status = err instanceof ImportError ? err.status : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
