'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { STATUS_LABELS, buildDiff, formatValue } from '../../../../lib/suggestions'
import Icon from '../../../../components/Icon'
import { AdminPage, AdminMessage, ErrorNote, StatusBadge, adminCard, adminMuted, adminBtn } from '../../../../components/admin/AdminUi'

export default function SuggestionReviewPage({ params }) {
  const { id } = params
  const [state, setState] = useState({ loading: true })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const { data: s } = await supabase.from('suggestions').select('*').eq('id', id).maybeSingle()
    if (!s) return setState({ loading: false, suggestion: null })
    const { data: target } = await supabase
      .from('suggestion_targets')
      .select('*')
      .eq('entity_type', s.entity_type)
      .maybeSingle()
    let current = null
    if (s.target_id && target) {
      const res = await supabase
        .from(target.table_name)
        .select('*')
        .eq(target.id_column, s.target_id)
        .maybeSingle()
      current = res.data
    }
    const { data: auth } = await supabase.auth.getUser()
    const { data: prof } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', auth?.user?.id)
      .maybeSingle()
    setState({ loading: false, suggestion: s, target, current, admin: !!prof?.is_admin })
  }

  useEffect(() => {
    load()
  }, [id])

  const decide = async (approve) => {
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('review_suggestion', {
      p_id: id,
      p_approve: approve,
      p_note: note,
    })
    if (err) setError(err.message)
    setBusy(false)
    load()
  }

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  const { suggestion: s, target, current, admin } = state
  if (!s) return <AdminMessage>Suggestion not found.</AdminMessage>
  if (!admin) return <AdminMessage>Admins only.</AdminMessage>

  const diff = buildDiff(s.payload, current)

  return (
    <AdminPage
      title={`${target?.label || s.entity_type}: ${s.target_id ? 'proposed edit' : 'proposed new entry'}`}
      back={{ href: '/admin/suggestions', label: 'All suggestions' }}
      description="Changed fields are highlighted."
      actions={<StatusBadge status={s.status} label={STATUS_LABELS[s.status]} />}
    >
      <div className={`${adminCard} hidden md:block overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Current and proposed values</caption>
          <thead>
            <tr className="text-left text-xs font-bold text-slate-600 dark:text-slate-300">
              <th scope="col" className="py-2 pr-3">Field</th>
              <th scope="col" className="pr-3">Current</th>
              <th scope="col">Proposed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {diff.map((r) => (
              <tr key={r.field} className={`align-top ${r.changed ? 'bg-amber-50 dark:bg-amber-950/30 font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                <td className="py-2 pr-3 break-words">{r.field}</td>
                <td className="pr-3 py-2 break-words">{formatValue(r.before)}</td>
                <td className="py-2 break-words">{formatValue(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden space-y-2">
        {diff.map((r) => (
          <li key={r.field} className={`${adminCard} space-y-1 text-sm ${r.changed ? 'border-amber-400 dark:border-amber-600' : ''}`}>
            <div className="font-bold text-slate-900 dark:text-white break-words">{r.field}{r.changed ? ' (changed)' : ''}</div>
            <div className={adminMuted}><span className="text-xs font-semibold">Current: </span><span className="break-words">{formatValue(r.before)}</span></div>
            <div className="text-slate-900 dark:text-white"><span className="text-xs font-semibold">Proposed: </span><span className="break-words">{formatValue(r.after)}</span></div>
          </li>
        ))}
      </ul>

      {s.status === 'pending' ? (
        <div className={`${adminCard} space-y-3`}>
          <label className="block text-sm font-bold text-slate-900 dark:text-white" htmlFor="review-note">Note to the submitter (optional)</label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button disabled={busy} onClick={() => decide(true)} className={`${adminBtn.success} w-full sm:w-auto`}>
              <Icon name="check" /> {busy ? 'Working…' : 'Approve'}
            </button>
            <button disabled={busy} onClick={() => decide(false)} className={`${adminBtn.danger} w-full sm:w-auto`}>
              <Icon name="close" /> Reject
            </button>
          </div>
        </div>
      ) : (
        s.review_note && <p className={`${adminCard} text-sm text-slate-900 dark:text-white`}><b>Note:</b> {s.review_note}</p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </AdminPage>
  )
}
