import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'

export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const title = body.title?.trim()
    const description = body.description?.trim()
    const severity = body.severity || 'medium'

    if (!title || !description) {
      return NextResponse.json(
        { error: 'Title and description are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('bug_reports')
      .insert({
        user_id: user.id,
        title,
        description,
        severity,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ report: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
