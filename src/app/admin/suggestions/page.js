'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { STATUS_LABELS, reviewPath } from '../../../lib/suggestions'
import { formatDateTime } from '../../../lib/dateFormat'
import SegmentedTabs from '../../../components/SegmentedTabs'
import Icon from '../../../components/Icon'
import { AdminPage, AdminMessage, EmptyState, StatusBadge, adminCard, adminMuted } from '../../../components/admin/AdminUi'

export default function AdminSuggestionsPage() {
  const [state, setState] = useState({ loading: true, admin: false, rows: [] })
  const [filter, setFilter] = useState('pending')

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

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  if (!state.admin) return <AdminMessage>Admins only.</AdminMessage>

  const count = (k) => state.rows.filter((r) => r.status === k).length
  const tabs = [['all', `All (${state.rows.length})`], ...Object.keys(STATUS_LABELS).map((k) => [k, `${STATUS_LABELS[k]} (${count(k)})`])]
  const shown = filter === 'all' ? state.rows : state.rows.filter((r) => r.status === filter)

  return (
    <AdminPage title="Suggestions" description="Rider-submitted edits and new entries waiting for review.">
      <SegmentedTabs label="Filter by status" tabs={tabs} value={filter} onChange={setFilter} />
      {shown.length === 0 && <EmptyState>No {filter === 'all' ? '' : `${STATUS_LABELS[filter].toLowerCase()} `}suggestions.</EmptyState>}
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.id}>
            <Link
              href={reviewPath(s.id)}
              className={`${adminCard} flex items-center justify-between gap-3 min-h-[56px] hover:border-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 dark:text-white break-words">{s.entity_type} · {s.target_id ? 'edit' : 'new'}</span>
                {s.target_id && <span className={`block text-xs ${adminMuted} truncate`} title={String(s.target_id)}>{s.target_id}</span>}
                <span className={`block text-xs ${adminMuted}`}>{formatDateTime(s.created_at)}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <StatusBadge status={s.status} label={STATUS_LABELS[s.status]} />
                <Icon name="chevronRight" className="text-slate-500" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AdminPage>
  )
}
