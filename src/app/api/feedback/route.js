import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../lib/supabaseServer'

const CATEGORIES = ['bug', 'feature_request', 'general']
const MODULES = [
  'aero_lab',
  'pursuit_strategist',
  'gear_architect',
  'pb_vault',
  'account_login',
  'other',
]

export async function POST(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const description = body.description?.trim()
    const category = CATEGORIES.includes(body.category) ? body.category : 'general'
    const module_ = MODULES.includes(body.module) ? body.module : 'other'

    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: user.id,
        category,
        module: module_,
        description,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ feedback: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req) {
  try {
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Shared community roadmap: everyone signed in sees every entry, but we
    // never surface user_id here so authorship stays private.
    const { data, error } = await supabase
      .from('feedback')
      .select('id, category, module, description, status, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ feedback: data })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
