import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { parseIntervalDsl } from '../../../lib/intervalDsl'

// GET /api/templates - list all declarative analysis templates (Phase 2 manifests)
// Visible rows are governed by RLS: system templates (user_id IS NULL), the
// caller's own templates, and other users' public templates.
export async function GET(req) {
  try {
    const { supabase } = await getRequestUser(req)
    const { data, error } = await supabase
      .from('analysis_templates')
      .select('*')
      .order('category')
      .order('name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, templates: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/templates - create a user-authored "custom_intervals" template
// (issue #14 — Template Creator) from a DSL source string.
export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { name, description, category, visibility, dslSource } = body

    if (!name || !dslSource) {
      return NextResponse.json({ error: 'Missing name or dslSource' }, { status: 400 })
    }

    const { repeatCount, steps, errors } = parseIntervalDsl(dslSource)
    if (errors.length) {
      return NextResponse.json({ error: 'Invalid interval DSL', errors }, { status: 400 })
    }

    const manifest = { pattern: 'custom_intervals', repeat_count: repeatCount, steps }
    const slug = `custom_${user.id.slice(0, 8)}_${Date.now()}`

    const { data, error } = await supabase
      .from('analysis_templates')
      .insert({
        slug,
        name,
        description: description || null,
        category: category || 'road',
        manifest,
        user_id: user.id,
        visibility: visibility === 'public' ? 'public' : 'private',
        dsl_source: dslSource,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, template: data })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
