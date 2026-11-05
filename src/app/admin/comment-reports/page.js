'use client'

import { useCallback, useEffect, useState } from 'react'
import Icon from '../../../components/Icon'
import { AdminPage, AdminMessage, EmptyState, ErrorNote, StatusBadge, Field, adminCard, adminBtn } from '../../../components/admin/AdminUi'
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

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  if (!state.admin) return <AdminMessage>Admins only.</AdminMessage>

  const open = state.rows.filter((r) => r.status === 'open').length

  return (
    <AdminPage title="Reported comments" description={`Review reports on activity comments. ${open} open.`}>
      <ErrorNote>{state.error}</ErrorNote>
      {state.rows.length === 0 && !state.error && <EmptyState>No reports.</EmptyState>}
      <ul className="space-y-3">
        {state.rows.map((r) => (
          <li key={r.id} className={`${adminCard} space-y-3`}>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={r.status} />
              {!r.comment_exists && r.status === 'open' && <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Comment already gone</span>}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-900 dark:text-white">{r.body_snapshot}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Author">{r.author_name || 'deleted rider'}</Field>
              <Field label="Reported by">{r.reporter_name || 'deleted rider'}</Field>
              <Field label="Reported">{formatDateTime(r.created_at)}</Field>
              {r.reason && <Field label="Reason">“{r.reason}”</Field>}
            </dl>
            {r.status === 'open' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={() => resolve(r, false)} className={adminBtn.secondary}>
                  <Icon name="check" /> Dismiss report
                </button>
                {r.comment_exists && (
                  <button type="button" onClick={() => resolve(r, true)} className={adminBtn.danger}>
                    <Icon name="trash" /> Delete comment
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </AdminPage>
  )
}
