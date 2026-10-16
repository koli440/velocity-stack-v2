'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { STATUS_LABELS, buildDiff, formatValue } from '../../../../lib/suggestions'

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

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  const { suggestion: s, target, current, admin } = state
  if (!s) return <p className="p-6 text-sm text-slate-500">Suggestion not found.</p>
  if (!admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  const diff = buildDiff(s.payload, current)

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <Link href="/admin/suggestions" className="text-xs underline text-slate-500">
        ← All suggestions
      </Link>
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">
        {target?.label || s.entity_type}: {s.target_id ? 'proposed edit' : 'proposed new entry'}
      </h1>
      <p className="text-sm text-slate-500">Status: {STATUS_LABELS[s.status]}</p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th>Field</th>
            <th>Current</th>
            <th>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {diff.map((r) => (
            <tr key={r.field} className={r.changed ? 'font-bold' : 'text-slate-400'}>
              <td className="py-1 pr-3">{r.field}</td>
              <td className="pr-3">{formatValue(r.before)}</td>
              <td>{formatValue(r.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {s.status === 'pending' ? (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note to the submitter"
            className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => decide(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => decide(false)}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-bold disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        s.review_note && <p className="text-sm">Note: {s.review_note}</p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
