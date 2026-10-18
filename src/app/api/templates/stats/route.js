import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { aggregateTemplateStats } from '../../../../lib/templateStats'
import { applyRunScope, attachSharedActivities, parseRunFilter, resolveRunScope } from '../../../../lib/coachRuns'

// GET /api/templates/stats[?filter=all|coach|own][&rider=<athleteId>]
// With ?rider= (coach in athlete context) only the runs THIS coach made on that athlete are counted.
// Per-template run statistics for the current user (single aggregated query; anonymous
// users get an empty result). Never cached. Only runs ON THE CALLER'S ACCOUNT count (user_id = caller):
// runs a coach makes on athletes live on the athletes' accounts, so they never count towards the
// coach's own statistics. Runs a coach made on the caller's activities are included (filter=coach
// shows only those, filter=own excludes them); `names` carries the stored template names, so
// templates the caller cannot read (a coach's private ones) can still be listed by name.
export async function GET(req) {
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ success: true, stats: {} }, noStore)

    const sp = new URL(req.url).searchParams
    const scope = resolveRunScope(sp.get('rider'), user.id)
    const filter = scope.coachId ? 'all' : parseRunFilter(sp.get('filter'))
    let query = supabase
      .from('template_executions')
      .select('id, template_id, activity_id, summary, created_at, by_coach, template_name, template_slug, template_category, activities(title, activity_date)')
    query = applyRunScope(query, scope)
    if (filter === 'coach') query = query.eq('by_coach', true)
    if (filter === 'own') query = query.eq('by_coach', false)
    const { data, error } = await query.order('created_at', { ascending: false }).limit(5000)

    if (error) return NextResponse.json({ error: error.message }, { status: 400, ...noStore })
    const rows = scope.coachId ? await attachSharedActivities(supabase, data) : data
    const stats = aggregateTemplateStats(rows)
    const names = {}
    for (const row of data || []) {
      if (row.template_id && stats[row.template_id] && !names[row.template_id]) {
        names[row.template_id] = { name: row.template_name, slug: row.template_slug, category: row.template_category }
      }
    }
    return NextResponse.json({ success: true, stats, names }, noStore)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, ...noStore })
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
