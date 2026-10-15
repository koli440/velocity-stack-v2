import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { buildIntervalManifest, parseIntervalDsl } from '../../../lib/intervalDsl'

// GET /api/templates - list all declarative analysis templates (Phase 2 manifests)
// Visible rows are governed by RLS: system templates (user_id IS NULL), the
// caller's own templates, and other users' public templates.
export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    const { data, error } = await supabase
      .from('analysis_templates')
      .select('*')
      .order('category')
      .order('name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Owner display names (authenticated callers only; public_profiles is not exposed to anon).
    const owners = {}
    const ownerIds = [...new Set((data || []).map((t) => t.user_id).filter(Boolean))]
    if (user && ownerIds.length) {
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, display_name')
        .in('id', ownerIds)
      for (const p of profiles || []) owners[p.id] = p.display_name
    }

    return NextResponse.json({ success: true, templates: data, owners })
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

    const parsedDsl = parseIntervalDsl(dslSource)
    const { errors } = parsedDsl
    if (errors.length) {
      return NextResponse.json({ error: 'Invalid interval DSL', errors }, { status: 400 })
    }

    const manifest = buildIntervalManifest(parsedDsl)
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

export const dynamic = 'force-dynamic'
