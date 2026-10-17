import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { evaluateTemplate } from '../../../../../lib/templateEngine'
import { weightFromActivity } from '../../../../../lib/weightHistory'
import { ZONE_SNAPSHOT_COLUMN, zonesFromActivity } from '../../../../../lib/powerZones'
import { LT_SNAPSHOT_COLUMNS, ltFromActivity } from '../../../../../lib/lactateThresholds'
import { coachRunnableTemplates, withTemplateSnapshot } from '../../../../../lib/coachRuns'

const NOT_FOUND = { error: 'Activity not found' }

// Coach path of POST. Evaluation inputs come from coach_template_run_inputs (active coach only, no GPS);
// the result is written by coach_save_template_run, which re-checks is_coach_of and that the template is
// the coach's own or a system template, and stamps the run. The template definition is never returned.
async function runAsCoach(supabase, user, activityId, { templateId, templateSlug }) {
  const { data: inputs, error: inErr } = await supabase.rpc('coach_template_run_inputs', { p_activity: activityId })
  if (inErr || !inputs) return NextResponse.json(NOT_FOUND, { status: 404 })

  let templateQuery = supabase.from('analysis_templates').select('*')
  templateQuery = templateId ? templateQuery.eq('id', templateId) : templateQuery.eq('slug', templateSlug)
  const { data: found } = await templateQuery.limit(2)
  const [template] = coachRunnableTemplates(found, user.id)
  if (!template) {
    return NextResponse.json({ error: 'Template not available for coach runs' }, { status: 404 })
  }

  const activity = { ...inputs, id: activityId }
  const result = evaluateTemplate(template, activity.time_series || {}, activity.ftp_at_activity_w ?? null, activity.max_hr ?? null, ltFromActivity(activity), weightFromActivity(activity), zonesFromActivity(activity))

  const { data: execution, error } = await supabase.rpc('coach_save_template_run', {
    p_activity: activityId,
    p_template: template.id,
    p_efforts: result.efforts || [],
    p_summary: result.summary || {},
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({
    success: true,
    execution: withTemplateSnapshot(execution),
    template: { id: template.id, slug: template.slug, name: template.name, category: template.category },
  })
}

// POST /api/activities/:id/apply-template  { templateId | templateSlug }
// Runs the template evaluation engine against the activity's stored time_series,
// persists the result to template_executions and marks the activity as
// processing_status = 'template_applied'.
export async function POST(req, { params }) {
  try {
    const activityId = params.id
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { templateId, templateSlug } = body

    if (!templateId && !templateSlug) {
      return NextResponse.json({ error: 'Missing templateId or templateSlug' }, { status: 400 })
    }

    const { data: activity, error: actError } = await supabase
      .from('activities')
      .select(`id, user_id, time_series, ftp_at_activity_w, max_hr, weight_at_activity_kg, ${ZONE_SNAPSHOT_COLUMN}, ${LT_SNAPSHOT_COLUMNS.join(', ')}`)
      .eq('id', activityId)
      .single()

    if (actError || !activity) {
      // Not the owner: an active coach of the rider may run his own / system templates (stored on the rider's account).
      return runAsCoach(supabase, user, activityId, { templateId, templateSlug })
    }

    if (activity.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let templateQuery = supabase.from('analysis_templates').select('*')
    templateQuery = templateId
      ? templateQuery.eq('id', templateId)
      : templateQuery.eq('slug', templateSlug)

    const { data: template, error: tplError } = await templateQuery.single()

    if (tplError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const result = evaluateTemplate(template, activity.time_series || {}, activity.ftp_at_activity_w ?? null, activity.max_hr ?? null, ltFromActivity(activity), weightFromActivity(activity), zonesFromActivity(activity))

    // A given template can only be run once per activity (unique constraint on
    // activity_id + template_id) — re-running replaces the prior result
    // instead of accumulating duplicate rows. Different templates can still
    // each have their own execution for the same activity.
    const { data: execution, error: execError } = await supabase
      .from('template_executions')
      .upsert(
        {
          activity_id: activity.id,
          template_id: template.id,
          user_id: user.id,
          by_coach: false,
          efforts: result.efforts || [],
          summary: result.summary || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'activity_id,template_id,coach_key' }
      )
      .select()
      .single()

    if (execError) {
      return NextResponse.json({ error: execError.message }, { status: 400 })
    }

    await supabase
      .from('activities')
      .update({ processing_status: 'template_applied' })
      .eq('id', activity.id)

    return NextResponse.json({ success: true, execution, template })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/activities/:id/apply-template?templateId=... (or ?executionId=...)
// Deletes a single template_executions row on the requesting user's account (the rider may delete
// any run, including coach runs), or a coach's own run on his athlete's activity. E.g.
// to clear a mis-matched run and re-run the template, or to remove a result
// the user no longer wants surfaced on the activity.
export async function DELETE(req, { params }) {
  try {
    const activityId = params.id
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const executionId = searchParams.get('executionId')
    const templateId = searchParams.get('templateId')

    if (!executionId && !templateId) {
      return NextResponse.json({ error: 'Missing executionId or templateId' }, { status: 400 })
    }

    let deleteQuery = supabase
      .from('template_executions')
      .delete()
      .eq('activity_id', activityId)
      .eq('user_id', user.id)

    deleteQuery = executionId ? deleteQuery.eq('id', executionId) : deleteQuery.eq('template_id', templateId)

    const { data, error } = await deleteQuery.select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if ((!data || data.length === 0) && executionId) {
      // Coach deleting his own run on an athlete's activity (checked in the database).
      const { error: coachErr } = await supabase.rpc('coach_delete_template_run', { p_execution: executionId })
      if (!coachErr) return NextResponse.json({ success: true })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/activities/:id/apply-template - list past executions for this activity
export async function GET(req, { params }) {
  try {
    const activityId = params.id
    const { supabase } = await getRequestUser(req)

    const { data, error } = await supabase
      .from('template_executions')
      .select('*, activities(activity_date)')
      .eq('activity_id', activityId)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Name/slug/category come from the run's own snapshot, so coach-private templates stay unreadable.
    return NextResponse.json({ success: true, executions: (data || []).map(withTemplateSnapshot) })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
