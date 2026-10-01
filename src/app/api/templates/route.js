import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'

// GET /api/templates - list all declarative analysis templates (Phase 2 manifests)
// Publicly readable reference data; no auth required.
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
