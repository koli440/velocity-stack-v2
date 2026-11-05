'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!state.ok) return <p className="p-6 text-sm text-slate-500">Admins only.</p>
  const names = Object.fromEntries(state.apps.map((a) => [a.id, a.name]))
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Partner apps</h1>
        <Link href="/admin" className="text-xs underline text-slate-500">Dashboard</Link>
      </div>
      {state.apps.length === 0 && <p className="text-sm text-slate-500">No apps registered.</p>}
      {state.apps.map((a) => (
        <div key={a.id} className="p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <b className="text-sm">{a.name}</b>
            <span className="uppercase font-bold text-slate-400">{a.status}</span>
          </div>
          {a.description && <p>{a.description}</p>}
          {a.homepage_url && <p>Website: {a.homepage_url}</p>}
          <p>Redirects: {a.redirect_uris.join(', ')}</p>
          <p className="text-slate-400">{a.scopes.join(', ')} · {a.rate_limit_per_min}/min · {a.rate_limit_per_day}/day · registered {formatDateTime(a.created_at)}</p>
          <div className="flex gap-3 pt-1">
            {a.status !== 'approved' && <button type="button" onClick={() => setStatus(a.id, 'approved')} className="font-bold uppercase text-emerald-600">Approve</button>}
            {a.status !== 'suspended' && <button type="button" onClick={() => setStatus(a.id, 'suspended')} className="font-bold uppercase text-red-500">Suspend</button>}
          </div>
        </div>
      ))}
      <h2 className="text-sm font-black uppercase tracking-wider">Recent activity</h2>
      <ul className="text-xs text-slate-500 space-y-0.5">
        {state.log.map((l) => <li key={l.id}>{formatDateTime(l.created_at)} · {l.event} · {names[l.app_id] || '—'}</li>)}
      </ul>
    </div>
  )
}
