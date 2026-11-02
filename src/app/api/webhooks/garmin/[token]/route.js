import { handleGarminWebhook } from '../../../../../lib/server/garminWebhookRoute'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Garmin's endpoint tool keeps paths but strips query strings: /api/webhooks/garmin/<GARMIN_WEBHOOK_TOKEN>
export const POST = (req, { params }) => handleGarminWebhook(req, decodeURIComponent(params.token))
