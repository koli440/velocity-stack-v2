import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'
import { listFavoriteIds } from '../../../../lib/templateMenu'

// GET /api/templates/favorites - ids of the caller's favorited templates
export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    const r = await listFavoriteIds(supabase, user)
    return NextResponse.json(r.body || { error: r.error }, { status: r.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
