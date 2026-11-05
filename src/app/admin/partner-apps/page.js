'use client'

import { useCallback, useEffect, useState } from 'react'
import Icon from '../../../components/Icon'
import { AdminPage, AdminMessage, EmptyState, StatusBadge, Field, adminCard, adminMuted, adminBtn } from '../../../components/admin/AdminUi'
import { getAuthHeader } from '../../../lib/supabase'
import { formatDateTime } from '../../../lib/dateFormat'

export default function AdminPartnerAppsPage() {
  const [state, setState] = useState({ loading: true, ok: false, apps: [], log: [] })

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/partner-apps', { headers: await getAuthHeader(), cache: 'no-store' })
    if (!res.ok) return setState({ loading: false, ok: false, apps: [], log: [] })
    const data = await res.json()
    setState({ loading: false, ok: true, apps: data.apps, log: data.log })
  }, [])
  useEffect(() => { load() }, [load])

  async function setStatus(id, status) {
    await fetch(`/api/admin/partner-apps/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) }, body: JSON.stringify({ status }) })
    load()
  }

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  if (!state.ok) return <AdminMessage>Admins only.</AdminMessage>
  const names = Object.fromEntries(state.apps.map((a) => [a.id, a.name]))
  return (
    <AdminPage title="Partner apps" description="Third-party apps registered to use the API. Approve to allow access, suspend to block it.">
      {state.apps.length === 0 && <EmptyState>No apps registered.</EmptyState>}
      <ul className="space-y-3">
        {state.apps.map((a) => (
          <li key={a.id} className={`${adminCard} space-y-3`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-lg font-black text-slate-900 dark:text-white break-words">{a.name}</h2>
              <StatusBadge status={a.status} />
            </div>
            {a.description && <p className="text-sm text-slate-900 dark:text-white break-words">{a.description}</p>}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {a.homepage_url && <Field label="Website"><span className="break-all">{a.homepage_url}</span></Field>}
              <Field label="Redirects"><span className="break-all">{a.redirect_uris.join(', ')}</span></Field>
              <Field label="Scopes">{a.scopes.join(', ') || '—'}</Field>
              <Field label="Rate limit">{a.rate_limit_per_min}/min · {a.rate_limit_per_day}/day</Field>
              <Field label="Registered">{formatDateTime(a.created_at)}</Field>
            </dl>
            <div className="flex flex-col sm:flex-row gap-2">
              {a.status !== 'approved' && <button type="button" onClick={() => setStatus(a.id, 'approved')} className={adminBtn.success}><Icon name="check" /> Approve</button>}
              {a.status !== 'suspended' && <button type="button" onClick={() => setStatus(a.id, 'suspended')} className={adminBtn.danger}><Icon name="close" /> Suspend</button>}
            </div>
          </li>
        ))}
      </ul>
      <section aria-labelledby="partner-activity" className={`${adminCard} space-y-2`}>
        <h2 id="partner-activity" className="text-lg font-black text-slate-900 dark:text-white">Recent activity</h2>
        {state.log.length === 0 && <p className={`text-sm ${adminMuted}`}>No activity yet.</p>}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {state.log.map((l) => (
            <li key={l.id} className="py-2 text-sm text-slate-900 dark:text-white flex flex-col sm:flex-row sm:gap-3">
              <span className={`${adminMuted} sm:w-48 shrink-0`}>{formatDateTime(l.created_at)}</span>
              <span className="break-words">{l.event} · {names[l.app_id] || '—'}</span>
            </li>
          ))}
        </ul>
      </section>
    </AdminPage>
  )
}
