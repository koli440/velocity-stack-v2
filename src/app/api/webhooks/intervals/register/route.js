import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const { athleteId, apiKey } = await req.json()

    if (!athleteId || !apiKey) {
      return NextResponse.json(
        { error: 'Chybí athleteId nebo apiKey' },
        { status: 400 }
      )
    }

    const authHeader = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

    // Dynamické určení domény (podporuje lokální ngrok i ostrou doménu)
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`
    const webhookUrl = `${appUrl}/api/webhooks/intervals`

    // Registrace subscription u Intervals.icu
    const subRes = await fetch(
      `https://intervals.icu/api/v1/athlete/${athleteId}/subscriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: webhookUrl,
          events: ['ACTIVITY_UPLOADED'],
        }),
      }
    )

    const subData = await subRes.json()

    if (!subRes.ok) {
      console.error('Subscription error from Intervals:', subData)
      return NextResponse.json(
        {
          error: `Intervals.icu odmítlo registraci: ${JSON.stringify(subData)}`,
        },
        { status: subRes.status }
      )
    }

    return NextResponse.json({
      success: true,
      subscription: subData,
      registeredUrl: webhookUrl,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}