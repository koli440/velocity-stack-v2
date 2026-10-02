import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { evaluateTemplate } from '../../../../../lib/templateEngine'

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
      .select('id, user_id, time_series, ftp_at_activity_w')
      .eq('id', activityId)
      .single()

    if (actError || !activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
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

    const result = evaluateTemplate(template, activity.time_series || {}, activity.ftp_at_activity_w ?? null)

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
          efforts: result.efforts || [],
          summary: result.summary || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'activity_id,template_id' }
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
// Deletes a single template_executions row owned by the requesting user, e.g.
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
      .select('*, analysis_templates(slug, name, category)')
      .eq('activity_id', activityId)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, executions: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
