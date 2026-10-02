import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { parseIntervalDsl } from '../../../../lib/intervalDsl'

// PATCH /api/templates/:slug - update a user-owned "custom_intervals" template
// (issue #14 — Template Creator). System templates (user_id IS NULL) and
// other users' templates cannot be edited from here.
export async function PATCH(req, { params }) {
  try {
    const slug = params.slug
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('analysis_templates')
      .select('*')
      .eq('slug', slug)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, category, visibility, dslSource } = body

    const updates = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (category !== undefined) updates.category = category
    if (visibility !== undefined) updates.visibility = visibility === 'public' ? 'public' : 'private'

    if (dslSource !== undefined) {
      const { repeatCount, steps, errors } = parseIntervalDsl(dslSource)
      if (errors.length) {
        return NextResponse.json({ error: 'Invalid interval DSL', errors }, { status: 400 })
      }
      updates.dsl_source = dslSource
      updates.manifest = { pattern: 'custom_intervals', repeat_count: repeatCount, steps }
    }

    const { data, error } = await supabase
      .from('analysis_templates')
      .update(updates)
      .eq('slug', slug)
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

// DELETE /api/templates/:slug - delete a user-owned template. template_executions
// referencing it cascade-delete via the existing FK.
export async function DELETE(req, { params }) {
  try {
    const slug = params.slug
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('analysis_templates')
      .select('id, user_id')
      .eq('slug', slug)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase.from('analysis_templates').delete().eq('slug', slug)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
