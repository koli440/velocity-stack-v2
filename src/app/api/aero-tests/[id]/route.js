import { NextResponse } from 'next/server'
import { getRequestUser } from '../../../../lib/supabaseServer'

// DELETE /api/aero-tests/:id - permanently remove an owned Aero Lab test record (v1's "Confirm
// Delete" button in the History section's "Delete a Record" expander).
export async function DELETE(req, { params }) {
  try {
    const { id } = params
    const { supabase, user } = await getRequestUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('aero_tests')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase.from('aero_tests').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
