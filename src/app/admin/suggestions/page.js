'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { STATUS_LABELS, reviewPath } from '../../../lib/suggestions'
import { formatDateTime } from '../../../lib/dateFormat'

export default function AdminSuggestionsPage() {
  const [state, setState] = useState({ loading: true, admin: false, rows: [] })

  useEffect(() => {
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id
      const { data: prof } = uid
        ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle()
        : { data: null }
      if (!prof?.is_admin) return setState({ loading: false, admin: false, rows: [] })
      const { data } = await supabase
        .from('suggestions')
        .select('id, entity_type, target_id, status, created_at')
        .order('status', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(100)
      setState({ loading: false, admin: true, rows: data || [] })
    })()
  }, [])

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!state.admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">Suggestions</h1>
      {state.rows.length === 0 && <p className="text-sm text-slate-500">No suggestions yet.</p>}
      {state.rows.map((s) => (
        <Link
          key={s.id}
          href={reviewPath(s.id)}
          className="block p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-sm"
        >
          <b>{s.entity_type}</b> · {s.target_id ? `edit ${s.target_id}` : 'new'} ·{' '}
          {STATUS_LABELS[s.status]}
          <span className="block text-xs text-slate-400">{formatDateTime(s.created_at)}</span>
        </Link>
      ))}
    </div>
  )
}
