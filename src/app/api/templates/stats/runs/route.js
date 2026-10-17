import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { escapeLike, mapRunRow, parseRunsParams } from '../../../../../lib/templateStats'
import { applyRunScope, attachSharedActivities, pageRunRows, parseRunFilter, resolveRunScope } from '../../../../../lib/coachRuns'

// GET /api/templates/stats/runs?template_id=&filter=all|coach|own&rider=<athleteId>&q=&sort=date|<metric>&dir=asc|desc&limit=&offset=
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

    const scope = resolveRunScope(searchParams.get('rider'), user.id)
    const filter = scope.coachId ? 'all' : parseRunFilter(searchParams.get('filter'))
    let data
    let count
    if (scope.coachId) {
      // Coach scope: the base activities table is not readable, so no activities!inner join (it would
      // drop every row). Titles/dates come from shared_activities; search/sort/paging run in memory.
      const res = await applyRunScope(
        supabase
          .from('template_executions')
          .select('id, activity_id, summary, created_at, by_coach, run_by_coach_id')
          .eq('template_id', templateId),
        scope
      ).limit(1000)
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400, ...noStore })
      const page = pageRunRows(await attachSharedActivities(supabase, res.data), { q, sort, dir, limit, offset })
      data = page.rows
      count = page.total
    } else {
      let query = supabase
        .from('template_executions')
        .select('id, activity_id, summary, created_at, by_coach, run_by_coach_id, activities!inner(title, activity_date)', { count: 'exact' })
        .eq('template_id', templateId)
      query = applyRunScope(query, scope)
      if (filter === 'coach') query = query.eq('by_coach', true)
      if (filter === 'own') query = query.eq('by_coach', false)
      if (q) query = query.ilike('activities.title', `%${escapeLike(q)}%`)
      const ascending = dir === 'asc'
      query =
        sort === 'date'
          ? query.order('activity_date', { foreignTable: 'activities', ascending })
          : query.order(`summary->${sort}`, { ascending, nullsFirst: false })
      const res = await query.order('id').range(offset, offset + limit - 1)
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400, ...noStore })
      data = res.data
      count = res.count
    }

    const runs = (data || []).map(mapRunRow)
    const total = count ?? offset + runs.length
    return NextResponse.json({ success: true, runs, total, hasMore: offset + runs.length < total }, noStore)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, ...noStore })
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
