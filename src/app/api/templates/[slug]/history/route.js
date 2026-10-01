import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'

// GET /api/templates/:slug/history
// Historical executions of a given template for the authenticated user, used by
// the Activity Detail benchmarking panel to compare against prior sessions.
export async function GET(req, { params }) {
  try {
    const slug = params.slug
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: template, error: tplError } = await supabase
      .from('analysis_templates')
      .select('id, slug, name, category')
      .eq('slug', slug)
      .single()

    if (tplError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('template_executions')
      .select('id, activity_id, summary, efforts, created_at, activities(title, activity_date)')
      .eq('template_id', template.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, template, executions: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
