import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { listRecentTemplateIds } from '../../../../lib/templateMenu'

// GET /api/templates/recent - ids of the caller's most recently run templates
export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    const r = await listRecentTemplateIds(supabase, user)
    return NextResponse.json(r.body || { error: r.error }, { status: r.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
