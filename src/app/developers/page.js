'use client'

// Developer registration for partner apps. New apps start as "pending" until an admin approves them.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getAuthHeader } from '../../lib/supabase'
import { PARTNER_SCOPES, SCOPE_LABELS } from '../../lib/partnerScopes'

const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm'
const STATUS = { pending: 'Pending review', approved: 'Approved', suspended: 'Suspended' }

export default function DevelopersPage() {
  const [apps, setApps] = useState(null)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', homepage_url: '', redirect_uris: '', scopes: ['activities:write'], confidential: true })

  const load = useCallback(async () => {
    const res = await fetch('/api/developers/apps', { headers: await getAuthHeader(), cache: 'no-store' })
    if (res.status === 401) return setApps(false)
    setApps(res.ok ? (await res.json()).apps : [])
  }, [])
  useEffect(() => { load() }, [load])

  async function submit(e) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/developers/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ ...form, redirect_uris: form.redirect_uris.split(/\s+/).filter(Boolean) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'Could not register the app')
    setCreated({ client_id: data.app.client_id, client_secret: data.client_secret })
    setForm({ ...form, name: '', description: '', homepage_url: '', redirect_uris: '' })
    load()
  }

  async function remove(app) {
    if (!window.confirm(`Delete ${app.name}? Connected riders lose access immediately.`)) return
    await fetch(`/api/developers/apps/${app.id}`, { method: 'DELETE', headers: await getAuthHeader() })
    load()
  }

  const toggleScope = (s) => setForm((f) => ({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] }))

  if (apps === false) {
    return <p className="p-6 text-sm text-slate-500"><Link href="/login?next=/developers" className="font-semibold underline">Log in</Link> to register an app.</p>
  }
  return (
    <section className="max-w-3xl mx-auto space-y-5 p-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Developers</h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Let your app send rides to Velocity Stack with OAuth 2.0 (authorization code + PKCE). New apps are reviewed manually before riders can connect. <Link href="/developers/docs" className="underline font-semibold">Read the API documentation</Link>.
        </p>
      </div>

      {created && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs space-y-1" role="status">
          <b>App registered (pending review).</b>
          <div>Client ID: <code className="break-all">{created.client_id}</code></div>
          {created.client_secret
            ? <div>Client secret (shown once, copy it now): <code className="break-all">{created.client_secret}</code></div>
            : <div>Public client: no secret, PKCE only.</div>}
        </div>
      )}

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <h2 className="text-sm font-black uppercase tracking-wider">Register an app</h2>
        <input className={input} placeholder="App name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
        <textarea className={input} placeholder="What does it do? (shown on the consent screen)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} rows={2} />
        <input className={input} type="url" placeholder="Website (https://…)" value={form.homepage_url} onChange={(e) => setForm({ ...form, homepage_url: e.target.value })} />
        <textarea className={input} placeholder="Redirect URIs, one per line (https, or http://localhost for development)" value={form.redirect_uris} onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })} rows={2} required />
        <fieldset className="space-y-1">
          <legend className="text-[11px] font-bold uppercase text-slate-400">Scopes</legend>
          {PARTNER_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.scopes.includes(s)} onChange={() => toggleScope(s)} /> <code>{s}</code> {SCOPE_LABELS[s]}</label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} /> Server-side app with a client secret (untick for a public PKCE-only app)</label>
        {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
        <button type="submit" disabled={!form.scopes.length} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50">Register</button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-black uppercase tracking-wider">Your apps</h2>
        {apps && apps.length === 0 && <p className="text-xs text-slate-500">No apps yet.</p>}
        {(apps || []).map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <b>{a.name}</b>
              <span className="text-[10px] font-bold uppercase text-slate-400">{STATUS[a.status] || a.status}</span>
            </div>
            <div>Client ID: <code className="break-all">{a.client_id}</code></div>
            <div className="text-slate-400">{a.scopes.join(', ')} · {a.rate_limit_per_min} req/min · {a.rate_limit_per_day} uploads/day</div>
            <button type="button" onClick={() => remove(a)} className="text-[11px] font-bold uppercase text-red-500 hover:underline">Delete</button>
          </div>
        ))}
      </div>
    </section>
  )
}
