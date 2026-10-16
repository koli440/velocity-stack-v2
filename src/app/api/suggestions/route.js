import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'
import { validateSuggestionInput } from '../../../lib/suggestions'

// Submit a suggestion. RLS + DB triggers enforce ownership, allowed fields and rate limits.
export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { data: targets, error: tErr } = await supabase
      .from('suggestion_targets')
      .select('entity_type, allowed_columns')
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 })

    const { value, error } = validateSuggestionInput(body, targets)
    if (error) return NextResponse.json({ error }, { status: 400 })

    const { error: insErr } = await supabase
      .from('suggestions')
      .insert({ ...value, submitter_id: user.id })
    if (insErr) {
      const limited = /Too many/i.test(insErr.message)
      return NextResponse.json({ error: insErr.message }, { status: limited ? 429 : 400 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
