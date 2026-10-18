'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { fetchCommentReports, resolveCommentReport, commentErrorMessage } from '../../../lib/activityComments'
import { formatDateTime } from '../../../lib/dateFormat'

export default function AdminCommentReportsPage() {
  const [state, setState] = useState({ loading: true, admin: false, rows: [], error: '' })

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    const { data: prof } = uid
      ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle()
      : { data: null }
    if (!prof?.is_admin) return setState({ loading: false, admin: false, rows: [], error: '' })
    const { reports, error } = await fetchCommentReports(supabase)
    setState({ loading: false, admin: true, rows: reports, error: error ? 'Reports could not be loaded.' : '' })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const resolve = async (row, remove) => {
    if (remove && !window.confirm('Delete this comment for everyone?')) return
    const { error } = await resolveCommentReport(supabase, { reportId: row.id, remove })
    if (error) return setState((s) => ({ ...s, error: commentErrorMessage(error) }))
    load()
  }

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!state.admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Reported comments</h1>
        <Link href="/admin/suggestions" className="text-xs underline text-slate-500">Suggestions</Link>
      </div>
      {state.error && <p role="alert" className="text-sm text-rose-500">{state.error}</p>}
      {state.rows.length === 0 && !state.error && <p className="text-sm text-slate-500">No reports.</p>}
      {state.rows.map((r) => (
        <div key={r.id} className="p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-sm space-y-2">
          <p className="whitespace-pre-wrap break-words text-slate-900 dark:text-white">{r.body_snapshot}</p>
          <p className="text-xs text-slate-500">
            by <b>{r.author_name || 'deleted rider'}</b> · reported by {r.reporter_name || 'deleted rider'} ·{' '}
            {formatDateTime(r.created_at)}
            {r.reason ? ` · “${r.reason}”` : ''}
          </p>
          <div className="flex items-center gap-3 text-xs font-bold">
            <span className="uppercase tracking-wider text-slate-400">{r.status}{!r.comment_exists && r.status === 'open' ? ' (comment gone)' : ''}</span>
            {r.status === 'open' && (
              <>
                <button type="button" onClick={() => resolve(r, false)} className="text-slate-500 hover:text-slate-700">Dismiss</button>
                {r.comment_exists && (
                  <button type="button" onClick={() => resolve(r, true)} className="text-rose-500 hover:text-rose-600">Delete comment</button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
