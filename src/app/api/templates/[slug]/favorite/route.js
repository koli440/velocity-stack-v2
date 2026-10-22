import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../../lib/supabaseServer'
import { addFavorite, removeFavorite } from '../../../../../lib/templateMenu'

// PUT /api/templates/:slug/favorite - add to favorites (any visible template)
export async function PUT(req, { params }) {
  try {
    const { supabase, user } = await getRequestUser(req)
    const r = await addFavorite(supabase, user, params.slug)
    return NextResponse.json(r.body || { error: r.error }, { status: r.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST is an alias of PUT so older cached clients that add favorites via POST keep working.
export const POST = PUT

// DELETE /api/templates/:slug/favorite - remove from favorites
export async function DELETE(req, { params }) {
  try {
    const { supabase, user } = await getRequestUser(req)
    const r = await removeFavorite(supabase, user, params.slug)
    return NextResponse.json(r.body || { error: r.error }, { status: r.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
