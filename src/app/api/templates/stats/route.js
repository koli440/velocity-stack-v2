import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { aggregateTemplateStats } from '../../../../lib/templateStats'

// GET /api/templates/stats
// Per-template run statistics for the current user (single aggregated query; anonymous
// users get an empty result). Never cached.
export async function GET(req) {
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ success: true, stats: {} }, noStore)

    const { data, error } = await supabase
      .from('template_executions')
      .select('id, template_id, activity_id, summary, created_at, activities(title, activity_date)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5000)

    if (error) return NextResponse.json({ error: error.message }, { status: 400, ...noStore })
    return NextResponse.json({ success: true, stats: aggregateTemplateStats(data) }, noStore)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, ...noStore })
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
