import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function getSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value
        },
        set(name, value, options) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name, options) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    }
  )
}

// GET /api/templates/:slug/history
// Historical executions of a given template for the authenticated user, used by
// the Activity Detail benchmarking panel to compare against prior sessions.
export async function GET(req, { params }) {
  try {
    const slug = params.slug
    const supabase = getSupabase()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
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
