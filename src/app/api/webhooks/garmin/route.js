import { handleGarminWebhook } from '../../../../lib/server/garminWebhookRoute'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Legacy form: ?token=GARMIN_WEBHOOK_TOKEN
export const POST = (req) => handleGarminWebhook(req, null)
