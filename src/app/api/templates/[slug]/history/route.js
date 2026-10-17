import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { applyRunScope, attachSharedActivities, resolveRunScope, withTemplateSnapshot } from '../../../../../lib/coachRuns'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/templates/:slug/history[?rider=<athleteId>[&coach_only=1]]
// Historical executions of a given template on the authenticated user's account (the rider's own runs
// AND runs a coach made on his activities, flagged by_coach / run_by_coach_id), used by the Activity
// Detail benchmarking panel. With ?rider= an active coach reads the athlete's history (RLS decides).
// Runs are matched by the template slug stored on the run, so a rider can compare coach runs of a
// template he cannot read; only name/slug/category are ever returned, never the definition.
export async function GET(req, { params }) {
  try {
    const slug = params.slug
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sp = new URL(req.url).searchParams
    const riderParam = sp.get('rider')
    const ownerId = riderParam && UUID_RE.test(riderParam) ? riderParam.toLowerCase() : user.id
    // ?coach_only=1 (Templates section in athlete context): only runs stamped by this coach.
    const scope = sp.get('coach_only') === '1' ? resolveRunScope(riderParam, user.id) : { ownerId, coachId: null }

    const { data, error } = await applyRunScope(
      supabase
        .from('template_executions')
        .select('id, activity_id, template_id, summary, efforts, created_at, by_coach, run_by_coach_id, template_name, template_slug, template_category, activities(title, activity_date)')
        .eq('template_slug', slug),
      scope
    )
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const rows = ownerId !== user.id ? await attachSharedActivities(supabase, data) : data
    const executions = (rows || []).map(withTemplateSnapshot)
    const first = executions[0]
    let template = first ? { id: first.template_id, slug, name: first.template_name, category: first.template_category } : null
    if (!template) {
      const { data: visible } = await supabase
        .from('analysis_templates')
        .select('id, slug, name, category')
        .eq('slug', slug)
        .maybeSingle()
      template = visible || null
    }
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, template, executions })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
