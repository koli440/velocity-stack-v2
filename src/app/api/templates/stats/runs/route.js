import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { escapeLike, mapRunRow, parseRunsParams } from '../../../../../lib/templateStats'
import { parseRunFilter } from '../../../../../lib/coachRuns'

// GET /api/templates/stats/runs?template_id=&filter=all|coach|own&q=&sort=date|<metric>&dir=asc|desc&limit=&offset=
// One page of the current user's runs of a template (loaded lazily by the Templates page
// modal). Never cached.
export async function GET(req) {
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ success: true, runs: [], total: 0, hasMore: false }, noStore)

    const { searchParams } = new URL(req.url)
    const templateId = searchParams.get('template_id')
    if (!templateId) return NextResponse.json({ error: 'template_id is required' }, { status: 400, ...noStore })
    const { limit, offset, sort, dir, q } = parseRunsParams(searchParams)

    let query = supabase
      .from('template_executions')
      .select('id, activity_id, summary, created_at, by_coach, run_by_coach_id, activities!inner(title, activity_date)', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('template_id', templateId)
    const filter = parseRunFilter(searchParams.get('filter'))
    if (filter === 'coach') query = query.eq('by_coach', true)
    if (filter === 'own') query = query.eq('by_coach', false)
    if (q) query = query.ilike('activities.title', `%${escapeLike(q)}%`)
    const ascending = dir === 'asc'
    query =
      sort === 'date'
        ? query.order('activity_date', { foreignTable: 'activities', ascending })
        : query.order(`summary->${sort}`, { ascending, nullsFirst: false })
    const { data, error, count } = await query.order('id').range(offset, offset + limit - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 400, ...noStore })
    const runs = (data || []).map(mapRunRow)
    const total = count ?? offset + runs.length
    return NextResponse.json({ success: true, runs, total, hasMore: offset + runs.length < total }, noStore)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, ...noStore })
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
