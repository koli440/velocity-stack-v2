import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { createIntervalsProvider } from '../../../../lib/server/intervalsProvider'
import { importActivity } from '../../../../lib/server/importActivity'
import { ImportError, DUPLICATE_MESSAGE } from '../../../../lib/server/importErrors'

const LIST_WINDOW_DAYS = 30

// Calls the Python analyzer (/api/analyze) for a downloaded .fit file; null on any failure so the
// provider falls back to raw streams.
function makeAnalyzeFit(req) {
  return async (blob, filename, { chainring, cog, isFixedGear } = {}) => {
    const formData = new FormData()
    formData.append('file', blob, filename)
    if (chainring) formData.append('chainring', String(chainring))
    if (cog) formData.append('cog', String(cog))
    if (isFixedGear) formData.append('is_fixed_gear', 'true')

    const res = await fetch(new URL('/api/analyze', req.url).toString(), { method: 'POST', body: formData })
    const contentType = res.headers.get('content-type') || ''
    if (!res.ok || !contentType.includes('application/json')) {
      console.warn(`/api/analyze returned ${res.status}; falling back to streams`)
      return null
    }
    return res.json()
  }
}

export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, activityId, trackId, isFixedGear } = await req.json()

    // Credentials always come from the caller's own profile_secrets row (RLS), never the request body.
    const { data: secrets } = await supabase
      .from('profile_secrets')
      .select('intervals_athlete_id, intervals_api_key')
      .eq('user_id', user.id)
      .maybeSingle()

    const provider = createIntervalsProvider({
      athleteId: secrets?.intervals_athlete_id,
      apiKey: secrets?.intervals_api_key,
    })

    if (action === 'list') {
      const since = new Date()
      since.setDate(since.getDate() - LIST_WINDOW_DAYS)
      const activities = await provider.listActivities({ oldest: since.toISOString().split('T')[0] })
      return NextResponse.json({ success: true, activities })
    }

    if (action === 'import') {
      if (!activityId) {
        return NextResponse.json({ error: 'Missing activityId' }, { status: 400 })
      }

      const result = await importActivity({
        supabase,
        userId: user.id,
        provider,
        externalId: activityId,
        options: { trackId: trackId || null, isFixedGear: !!isFixedGear },
        analyzeFit: makeAnalyzeFit(req),
      })

      if (result.status === 'skipped') {
        return NextResponse.json({ error: DUPLICATE_MESSAGE, duplicate: true }, { status: 409 })
      }
      return NextResponse.json({
        success: true,
        status: result.status,
        activityId: result.activity.id,
        replacedId: result.replacedId ?? null,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    const status = err instanceof ImportError ? err.status : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
