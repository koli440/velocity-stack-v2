'use client'

// Admin dashboard: aggregate-only overview (suggestions, users, rides, templates, provider sync).
// Data: admin-only RPC admin_dashboard_stats(); it returns counts and anonymous lists, never user identities.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { reviewPath } from '../../lib/suggestions'
import { formatDateTime } from '../../lib/dateFormat'
import { dayLabel, maxCount, pct, providerHealth, providerLabel, sumSeries, TYPE_LABELS, trend, withAllProviders } from '../../lib/adminDashboard'

const card = 'p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder space-y-3'
const HEALTH = {
  ok: ['OK', 'text-emerald-500'], warn: ['Stale', 'text-amber-500'], error: ['Errors', 'text-red-500'], idle: ['Not connected', 'text-slate-400'],
}

function Stat({ label, value, tone }) {
  return (
    <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-surface-darkBorder min-w-[6.5rem] flex-1">
      <div className="text-[10px] uppercase font-bold text-slate-400">{label}</div>
      <div className={`text-lg font-black ${tone || 'text-slate-900 dark:text-white'}`}>{value ?? '—'}</div>
    </div>
  )
}

function Panel({ title, id, link, children }) {
  return (
    <section aria-labelledby={id} className={card}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id={id} className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">{title}</h2>
        {link && <Link href={link.href} className="text-xs underline text-slate-500">{link.label}</Link>}
      </div>
      {children}
    </section>
  )
}

function Bars({ series, label, tone = 'bg-orange-500' }) {
  const max = maxCount(series)
  const t = trend(series)
  return (
    <figure className="space-y-1">
      <figcaption className="text-[11px] text-slate-400">
        {label}: <b className="text-slate-600 dark:text-slate-300">{sumSeries(series)}</b> in {series?.length || 0} days ·{' '}
        {t.direction === 'flat' ? 'flat' : `${t.direction === 'up' ? '▲' : '▼'} ${Math.abs(t.delta)} vs earlier half`}
      </figcaption>
      <div className="flex items-end gap-[2px] h-16" role="img" aria-label={`${label} per day`}>
        {(series || []).map((p) => (
          <div key={p.day} title={`${dayLabel(p.day)}: ${p.count}`} className={`flex-1 rounded-t ${tone} ${p.count ? '' : 'opacity-20'}`} style={{ height: `${Math.max(4, (p.count / max) * 100)}%` }} />
        ))}
      </div>
    </figure>
  )
}

function Breakdown({ rows, labelOf }) {
  const total = rows.reduce((n, r) => n + r.count, 0)
  if (!rows.length) return <p className="text-xs text-slate-400">No data in this period.</p>
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="text-xs">
          <div className="flex justify-between"><span>{labelOf(r.key)}</span><span className="font-mono">{r.count} · {pct(r.count, total)}%</span></div>
          <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded bg-orange-500" style={{ width: `${pct(r.count, total)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

export default function AdminDashboardPage() {
  const [state, setState] = useState({ loading: true, admin: false, data: null, error: '' })
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    const { data: prof } = uid ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle() : { data: null }
    if (!prof?.is_admin) return setState({ loading: false, admin: false, data: null, error: '' })
    const { data, error } = await supabase.rpc('admin_dashboard_stats', { p_days: days })
    setState({ loading: false, admin: true, data: data || null, error: error?.message || '' })
  }, [days])

  useEffect(() => { load() }, [load])

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!state.admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  const d = state.data
  const s = d?.suggestions
  const u = d?.users
  const r = d?.rides
  const t = d?.templates

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Admin dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`font-black uppercase tracking-wider ${days === n ? 'text-orange-500' : 'text-slate-400'}`}>{n}d</button>
          ))}
          <button type="button" onClick={load} className="underline text-slate-500">Refresh</button>
        </div>
      </div>
      <nav aria-label="Admin pages" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href="/admin/suggestions" className="underline text-slate-500">Suggestions</Link>
        <Link href="/admin/exercises" className="underline text-slate-500">Exercise mapping</Link>
        <Link href="/admin/comment-reports" className="underline text-slate-500">Reported comments</Link>
        <Link href="/admin/template-reruns" className="underline text-slate-500">Template re-run</Link>
      </nav>
      <p className="text-xs text-slate-400">Aggregates only: no names, e-mails or other personal data are shown here. Bots are excluded from users and rides.{d ? ` Updated ${formatDateTime(d.generated_at)}.` : ''}</p>
      {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}

      {d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Suggestions" id="p-suggestions" link={{ href: '/admin/suggestions', label: 'All suggestions' }}>
            <div className="flex flex-wrap gap-2">
              <Stat label="Pending" value={s.pending} tone={s.pending ? 'text-amber-500' : undefined} />
              <Stat label="Approved 30d" value={s.approved_30d} tone="text-emerald-500" />
              <Stat label="Rejected 30d" value={s.rejected_30d} />
              <Stat label="Unmatched exercises" value={s.unmatched_exercises} tone={s.unmatched_exercises ? 'text-amber-500' : undefined} />
              <Stat label="Open reports" value={s.open_comment_reports} tone={s.open_comment_reports ? 'text-red-500' : undefined} />
            </div>
            {s.oldest_pending && <p className="text-[11px] text-slate-400">Oldest pending: {formatDateTime(s.oldest_pending)}</p>}
            {s.by_type.length > 0 && (
              <p className="text-xs text-slate-500">{s.by_type.map((x) => `${x.entity_type} ${x.count}`).join(' · ')}</p>
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.recent_pending.map((p) => (
                <li key={p.id}>
                  <Link href={reviewPath(p.id)} className="flex justify-between gap-2 py-1.5 text-xs hover:text-orange-500">
                    <span><b>{p.entity_type}</b> · {p.target_id ? 'edit' : 'new'} <span className="text-slate-400">{formatDateTime(p.created_at)}</span></span>
                    <span className="font-black uppercase text-[10px] text-orange-500">Review</span>
                  </Link>
                </li>
              ))}
              {s.recent_pending.length === 0 && <li className="py-1.5 text-xs text-slate-400">Nothing waiting for review.</li>}
            </ul>
            <div className="flex gap-4 text-xs">
              <Link href="/admin/exercises" className="underline text-slate-500">Map exercises</Link>
              <Link href="/admin/comment-reports" className="underline text-slate-500">Reported comments</Link>
            </div>
          </Panel>

          <Panel title="Users" id="p-users">
            <div className="flex flex-wrap gap-2">
              <Stat label="Total" value={u.total} />
              <Stat label="New today" value={u.new_today} />
              <Stat label="New 7d" value={u.new_7d} />
              <Stat label="New 30d" value={u.new_30d} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Stat label="Active 7d" value={u.active_7d} tone="text-emerald-500" />
              <Stat label="Active 30d" value={u.active_30d} tone="text-emerald-500" />
              <Stat label="Inactive 30d+" value={u.inactive_30d} tone="text-amber-500" />
              <Stat label="Never uploaded" value={u.never_uploaded} />
              <Stat label="Coaching" value={`${u.coaching_active} (+${u.coaching_pending} pending)`} />
            </div>
            <Bars series={u.signups_by_day} label="Signups" />
          </Panel>

          <Panel title="Rides" id="p-rides">
            <div className="flex flex-wrap gap-2">
              <Stat label="Total" value={r.total} />
              <Stat label="New today" value={r.new_today} />
              <Stat label="New 7d" value={r.new_7d} />
              <Stat label="New 30d" value={r.new_30d} />
            </div>
            <Bars series={r.by_day} label="Uploads" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div><h3 className="text-[10px] uppercase font-bold text-slate-400 mb-1">By source</h3>
                <Breakdown rows={r.by_source.map((x) => ({ key: x.source, count: x.count }))} labelOf={providerLabel} /></div>
              <div><h3 className="text-[10px] uppercase font-bold text-slate-400 mb-1">By type</h3>
                <Breakdown rows={r.by_type.map((x) => ({ key: x.type, count: x.count }))} labelOf={(k) => TYPE_LABELS[k] || k} /></div>
            </div>
          </Panel>

          <Panel title="Templates" id="p-templates" link={{ href: '/admin/template-reruns', label: 'Re-run job' }}>
            <div className="flex flex-wrap gap-2">
              <Stat label="User private" value={t.user_private} />
              <Stat label="User public" value={t.user_public} />
              <Stat label="System" value={t.system} />
              <Stat label="Created 7d" value={t.created_7d} />
              <Stat label="Created 30d" value={t.created_30d} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Stat label="Runs total" value={t.runs_total} />
              <Stat label="Runs 7d" value={t.runs_7d} />
              <Stat label="Runs 30d" value={t.runs_30d} />
              <Stat label="Re-run failures" value={t.rerun_failed} tone={t.rerun_failed ? 'text-red-500' : undefined} />
            </div>
            <Bars series={t.created_by_day} label="Templates created" tone="bg-sky-500" />
            <Bars series={t.runs_by_day} label="Template runs" tone="bg-emerald-500" />
          </Panel>

          <div className="lg:col-span-2">
            <Panel title="Synchronisation" id="p-sync">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[36rem]">
                  <caption className="sr-only">Connected accounts and sync health per provider</caption>
                  <thead className="text-left text-[10px] uppercase text-slate-400">
                    <tr><th scope="col" className="py-1 pr-3">Provider</th><th scope="col" className="pr-3">Connected</th><th scope="col" className="pr-3">Errors</th><th scope="col" className="pr-3">Stale (3d+)</th><th scope="col" className="pr-3">Imported 24h / 7d</th><th scope="col" className="pr-3">Last sync</th><th scope="col">Health</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {withAllProviders(d.sync.providers).map((p) => {
                      const [text, tone] = HEALTH[providerHealth(p)]
                      return (
                        <tr key={p.provider}>
                          <td className="py-1.5 pr-3 font-black">{providerLabel(p.provider)}</td>
                          <td className="pr-3 font-mono">{p.connected}</td>
                          <td className={`pr-3 font-mono ${p.errors ? 'text-red-500' : ''}`}>{p.errors}</td>
                          <td className={`pr-3 font-mono ${p.stale ? 'text-amber-500' : ''}`}>{p.stale}</td>
                          <td className="pr-3 font-mono">{p.imported_24h} / {p.imported_7d}</td>
                          <td className="pr-3 text-slate-400">{p.last_synced_at ? formatDateTime(p.last_synced_at) : '—'}</td>
                          <td className={`font-black ${tone}`}>{text}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Stat label="Garmin events 24h" value={d.sync.garmin_events.received_24h} />
                <Stat label="Garmin events 7d" value={d.sync.garmin_events.received_7d} />
                <Stat label="Last Garmin event" value={d.sync.garmin_events.last_received_at ? formatDateTime(d.sync.garmin_events.last_received_at) : '—'} />
                {Object.entries(d.sync.garmin_events.by_status_7d || {}).map(([k, v]) => (
                  <Stat key={k} label={`Garmin ${k} 7d`} value={v} tone={k === 'error' && v ? 'text-red-500' : undefined} />
                ))}
              </div>
              <h3 className="text-[10px] uppercase font-bold text-slate-400">Recent connection errors</h3>
              <ul className="space-y-1 text-xs">
                {d.sync.recent_errors.map((e) => (
                  <li key={`${e.provider}-${e.message}`} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words"><b>{providerLabel(e.provider)}</b> · {e.message}</span>
                    <span className="font-mono text-slate-400 shrink-0">×{e.count}</span>
                  </li>
                ))}
                {d.sync.recent_errors.length === 0 && <li className="text-slate-400">No connections in an error state.</li>}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
