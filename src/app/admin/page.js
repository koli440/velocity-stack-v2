'use client'

// Admin dashboard: aggregate-only overview (suggestions, users, rides, templates, provider sync).
// Data: admin-only RPC admin_dashboard_stats(); it returns counts and anonymous lists, never user identities.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { reviewPath } from '../../lib/suggestions'
import { formatDateTime } from '../../lib/dateFormat'
import { dayLabel, maxCount, pct, providerHealth, providerLabel, sumSeries, TYPE_LABELS, trend, withAllProviders, failureRate, partnerAppHealth, respectSummary } from '../../lib/adminDashboard'
import SegmentedTabs from '../../components/SegmentedTabs'
import Icon from '../../components/Icon'

const card = 'glass-dense h-full rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 sm:p-5 space-y-4'
const subheading = 'text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5'
const muted = 'text-slate-500 dark:text-slate-300'
const HEALTH = {
  ok: ['OK', 'text-emerald-600 dark:text-emerald-400'], warn: ['Stale', 'text-amber-600 dark:text-amber-400'], error: ['Errors', 'text-red-600 dark:text-red-400'], idle: ['Not connected', 'text-slate-500 dark:text-slate-300'],
}
const TONES = { good: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400' }
const PERIODS = [['7', '7D'], ['30', '30D'], ['90', '90D']]

function Stat({ label, value, tone, hint }) {
  return (
    <div className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 min-w-0">
      <div className={`text-xs font-semibold ${muted}`}>{label}</div>
      <div className={`text-2xl font-black leading-tight break-words ${TONES[tone] || 'text-slate-900 dark:text-white'}`}>{value ?? '—'}</div>
      {hint && <div className={`text-xs ${muted}`}>{hint}</div>}
    </div>
  )
}

function StatGrid({ children, cols = 'sm:grid-cols-3' }) {
  return <div className={`grid grid-cols-2 gap-2 ${cols}`}>{children}</div>
}

function Panel({ title, id, link, children }) {
  return (
    <section aria-labelledby={id} className={card}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id={id} className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
        {link && <Link href={link.href} className="inline-flex items-center min-h-[44px] lg:min-h-0 text-sm font-bold text-orange-600 dark:text-orange-400 hover:underline">{link.label} →</Link>}
      </div>
      {children}
    </section>
  )
}

function Bars({ series, label, tone = 'bg-orange-500' }) {
  const max = maxCount(series)
  const t = trend(series)
  const list = series || []
  const peak = list.reduce((best, p) => (p.count > (best?.count ?? -1) ? p : best), null)
  return (
    <figure className="space-y-1">
      <figcaption className={`text-xs ${muted}`}>
        {label}: <b className="text-slate-800 dark:text-white">{sumSeries(series)}</b> in {list.length} days ·{' '}
        {t.direction === 'flat' ? 'flat' : `${t.direction === 'up' ? '▲' : '▼'} ${Math.abs(t.delta)} vs earlier half`}
      </figcaption>
      <div className="flex items-end gap-[2px] h-20" role="img" aria-label={`${label} per day`}>
        {list.map((p) => (
          <div key={p.day} title={`${dayLabel(p.day)}: ${p.count}`} className={`flex-1 rounded-t ${tone} ${p.count ? '' : 'opacity-20'}`} style={{ height: `${Math.max(4, (p.count / max) * 100)}%` }} />
        ))}
      </div>
      {list.length > 0 && (
        <div className={`flex justify-between gap-2 text-xs ${muted}`}>
          <span>{dayLabel(list[0].day)}</span>
          <span>Peak {peak?.count ?? 0}{peak?.count ? ` on ${dayLabel(peak.day)}` : ''}</span>
          <span>{dayLabel(list[list.length - 1].day)}</span>
        </div>
      )}
    </figure>
  )
}

function Breakdown({ rows, labelOf }) {
  const total = rows.reduce((n, r) => n + r.count, 0)
  if (!rows.length) return <p className={`text-sm ${muted}`}>No data in this period.</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-2"><span>{labelOf(r.key)}</span><span className="font-mono">{r.count} · {pct(r.count, total)}%</span></div>
          <div className="h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-orange-500" style={{ width: `${pct(r.count, total)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${className}`}>
      <span className={muted}>{label}</span><span className="font-mono text-right">{children}</span>
    </div>
  )
}

export default function AdminDashboardPage() {
  const [state, setState] = useState({ loading: true, admin: false, data: null, error: '' })
  const [days, setDays] = useState(30)
  const [partner, setPartner] = useState(null)
  const [respect, setRespect] = useState(null)

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    const { data: prof } = uid ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle() : { data: null }
    if (!prof?.is_admin) return setState({ loading: false, admin: false, data: null, error: '' })
    const { data, error } = await supabase.rpc('admin_dashboard_stats', { p_days: days })
    const pr = await supabase.rpc('admin_partner_stats', { p_days: days })
    setPartner(pr.data || null)
    const rs = await supabase.rpc('admin_respect_stats', { p_days: days })
    setRespect(rs.data || null)
    setState({ loading: false, admin: true, data: data || null, error: error?.message || '' })
  }, [days])

  useEffect(() => { load() }, [load])

  if (state.loading) return <p className={`p-6 text-sm ${muted}`}>Loading…</p>
  if (!state.admin) return <p className={`p-6 text-sm ${muted}`}>Admins only.</p>

  const d = state.data
  const s = d?.suggestions
  const u = d?.users
  const r = d?.rides
  const t = d?.templates

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">Admin dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedTabs
            label="Period"
            tabs={PERIODS}
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            className="[&_button]:min-h-[44px] lg:[&_button]:min-h-0"
          />
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 min-h-[44px] lg:min-h-[38px] px-4 rounded-xl text-sm font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <Icon name="refresh" /> Refresh
          </button>
        </div>
      </div>
      <p className={`text-sm ${muted}`}>Aggregates only: no names, e-mails or other personal data are shown here. Bots are excluded from users and rides.{d ? ` Updated ${formatDateTime(d.generated_at)}.` : ''}</p>
      {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      {d && (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            <Stat label="Users" value={u.total} hint={`${u.active_7d} active 7d`} />
            <Stat label="New users 7d" value={u.new_7d} hint={`${u.new_today} today`} />
            <Stat label="Rides 7d" value={r.new_7d} hint={`${r.total} total`} />
            <Stat label="Templates created 7d" value={t.created_7d} hint={`${t.runs_7d} runs`} />
            <Stat label="Pending suggestions" value={s.pending} tone={s.pending ? 'warn' : undefined} />
            <Stat label="Open reports" value={s.open_comment_reports} tone={s.open_comment_reports ? 'bad' : undefined} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2 items-stretch">
            <Panel title="Suggestions" id="p-suggestions" link={{ href: '/admin/suggestions', label: 'All suggestions' }}>
              <StatGrid>
                <Stat label="Pending" value={s.pending} tone={s.pending ? 'warn' : undefined} />
                <Stat label="Approved 30d" value={s.approved_30d} tone="good" />
                <Stat label="Rejected 30d" value={s.rejected_30d} />
                <Stat label="Unmatched exercises" value={s.unmatched_exercises} tone={s.unmatched_exercises ? 'warn' : undefined} />
                <Stat label="Open reports" value={s.open_comment_reports} tone={s.open_comment_reports ? 'bad' : undefined} />
              </StatGrid>
              {s.oldest_pending && <p className={`text-sm ${muted}`}>Oldest pending: {formatDateTime(s.oldest_pending)}</p>}
              {s.by_type.length > 0 && (
                <p className={`text-sm ${muted}`}>{s.by_type.map((x) => `${x.entity_type} ${x.count}`).join(' · ')}</p>
              )}
              {s.recent_pending.length > 0 && (
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {s.recent_pending.map((p) => (
                    <li key={p.id}>
                      <Link href={reviewPath(p.id)} className="flex items-center justify-between gap-2 min-h-[44px] lg:min-h-0 lg:py-2 text-sm hover:text-orange-600">
                        <span><b>{p.entity_type}</b> · {p.target_id ? 'edit' : 'new'} <span className={muted}>{formatDateTime(p.created_at)}</span></span>
                        <span className="font-bold text-orange-600 dark:text-orange-400">Review →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-x-5 text-sm font-bold">
                <Link href="/admin/exercises" className="inline-flex items-center min-h-[44px] lg:min-h-0 text-orange-600 dark:text-orange-400 hover:underline">Map exercises</Link>
                <Link href="/admin/comment-reports" className="inline-flex items-center min-h-[44px] lg:min-h-0 text-orange-600 dark:text-orange-400 hover:underline">Reported comments</Link>
              </div>
            </Panel>

            <Panel title="Users" id="p-users">
              <StatGrid cols="sm:grid-cols-4">
                <Stat label="Total" value={u.total} />
                <Stat label="New today" value={u.new_today} />
                <Stat label="New 7d" value={u.new_7d} />
                <Stat label="New 30d" value={u.new_30d} />
              </StatGrid>
              <StatGrid>
                <Stat label="Active 7d" value={u.active_7d} tone="good" />
                <Stat label="Active 30d" value={u.active_30d} tone="good" />
                <Stat label="Inactive 30d+" value={u.inactive_30d} tone="warn" />
                <Stat label="Never uploaded" value={u.never_uploaded} />
                <Stat label="Coaching" value={u.coaching_active} hint={`+${u.coaching_pending} pending`} />
              </StatGrid>
              <Bars series={u.signups_by_day} label="Signups" />
            </Panel>

            <Panel title="Rides" id="p-rides">
              <StatGrid cols="sm:grid-cols-4">
                <Stat label="Total" value={r.total} />
                <Stat label="New today" value={r.new_today} />
                <Stat label="New 7d" value={r.new_7d} />
                <Stat label="New 30d" value={r.new_30d} />
              </StatGrid>
              <Bars series={r.by_day} label="Uploads" />
              <div className="grid sm:grid-cols-2 gap-4">
                <div><h3 className={subheading}>By source</h3>
                  <Breakdown rows={r.by_source.map((x) => ({ key: x.source, count: x.count }))} labelOf={providerLabel} /></div>
                <div><h3 className={subheading}>By type</h3>
                  <Breakdown rows={r.by_type.map((x) => ({ key: x.type, count: x.count }))} labelOf={(k) => TYPE_LABELS[k] || k} /></div>
              </div>
            </Panel>

            <Panel title="Templates" id="p-templates" link={{ href: '/admin/template-reruns', label: 'Re-run job' }}>
              <StatGrid>
                <Stat label="User private" value={t.user_private} />
                <Stat label="User public" value={t.user_public} />
                <Stat label="System" value={t.system} />
                <Stat label="Created 7d" value={t.created_7d} />
                <Stat label="Created 30d" value={t.created_30d} />
              </StatGrid>
              <StatGrid cols="sm:grid-cols-4">
                <Stat label="Runs total" value={t.runs_total} />
                <Stat label="Runs 7d" value={t.runs_7d} />
                <Stat label="Runs 30d" value={t.runs_30d} />
                <Stat label="Re-run failures" value={t.rerun_failed} tone={t.rerun_failed ? 'bad' : undefined} />
              </StatGrid>
              <Bars series={t.created_by_day} label="Templates created" tone="bg-sky-500" />
              <Bars series={t.runs_by_day} label="Template runs" tone="bg-emerald-500" />
            </Panel>

            {respect && (() => {
              const k = respectSummary(respect)
              return (
                <Panel title="Respect" id="p-respect">
                  <StatGrid cols="sm:grid-cols-4">
                    <Stat label={`Respects ${respect.days}d`} value={respect.total} hint={`${respect.total_all_time} all time`} />
                    <Stat label="Reactors" value={respect.reactors} hint={`${respect.receivers} receivers`} />
                    <Stat label="Activities reacted to" value={respect.activities} />
                    <Stat label="Avg per activity" value={k.perActivity} />
                  </StatGrid>
                  <Bars series={respect.by_day} label="Respects" tone="bg-rose-500" />
                  <StatGrid cols="sm:grid-cols-2">
                    <Stat label="Active users who gave" value={`${k.gavePct}%`} hint={`${respect.active_gave} of ${respect.active_users}`} />
                    <Stat label="Active users who received" value={`${k.receivedPct}%`} hint={`${respect.active_received} of ${respect.active_users}`} />
                  </StatGrid>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><h3 className={subheading}>By activity type</h3>
                      <Breakdown rows={respect.by_type.map((x) => ({ key: x.type, count: x.count }))} labelOf={(key) => TYPE_LABELS[key] || key} /></div>
                    <div><h3 className={subheading}>Public vs not public</h3>
                      <Breakdown rows={[{ key: 'public', count: respect.by_visibility.public }, { key: 'non_public', count: respect.by_visibility.non_public }].filter((x) => x.count > 0)} labelOf={(key) => (key === 'public' ? 'Public' : 'Followers / private')} /></div>
                  </div>
                  <StatGrid cols="sm:grid-cols-4">
                    <Stat label="Notifications sent" value={respect.notifications_sent} hint={`covering ${respect.notified_reactions} respects`} />
                    <Stat label="Notifications off" value={respect.opt_out_notifications} hint={`of ${respect.users_total} users`} />
                    <Stat label="Reactions off" value={respect.opt_out_reactions} hint={`of ${respect.users_total} users`} />
                  </StatGrid>
                  <p className={`text-xs ${muted}`}>Rate-limit hits are not recorded, so they are not shown.</p>
                </Panel>
              )
            })()}

            {partner && (
              <div className="lg:col-span-2">
                <Panel title="Third-party apps" id="p-partners" link={{ href: '/admin/partner-apps', label: 'Manage apps' }}>
                  <StatGrid cols="sm:grid-cols-4">
                    <Stat label="Pending" value={partner.apps_by_status.pending} tone={partner.apps_by_status.pending ? 'warn' : undefined} />
                    <Stat label="Approved" value={partner.apps_by_status.approved} tone="good" />
                    <Stat label="Suspended" value={partner.apps_by_status.suspended} />
                    <Stat label="Connected riders" value={partner.connected_riders} />
                  </StatGrid>
                  <Bars series={partner.uploads_by_day} label="Uploads" tone="bg-emerald-500" />

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm" data-testid="partner-stats-table">
                      <thead><tr className={`text-left text-xs font-bold ${muted} border-b border-slate-200 dark:border-slate-700`}>
                        <th className="pr-3 py-2">App</th><th className="pr-3">Riders</th><th className="pr-3">24h / 7d / 30d / all</th><th className="pr-3">Imported / dup / failed</th><th className="pr-3">Fail %</th><th className="pr-3">Activities</th><th className="pr-3">429 7d</th><th className="pr-3">Refresh 7d</th><th className="pr-3">Reuse</th><th>Last upload</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700 [&>tr:nth-child(even)]:bg-slate-50 dark:[&>tr:nth-child(even)]:bg-slate-800/40">
                        {partner.apps.map((a) => (
                          <tr key={a.id}>
                            <td className="pr-3 py-2"><Link href="/admin/partner-apps" className="underline font-bold">{a.name}</Link> <span className={`text-xs ${a.status === 'approved' ? (partnerAppHealth(a) === 'warn' ? TONES.warn : TONES.good) : muted}`}>{a.status === 'approved' && partnerAppHealth(a) === 'warn' ? 'check' : a.status}</span></td>
                            <td className="pr-3">{a.riders}</td>
                            <td className="pr-3 font-mono">{a.uploads_24h} / {a.uploads_7d} / {a.uploads_30d} / {a.uploads_total}</td>
                            <td className="pr-3 font-mono">{a.imported} / {a.duplicate} / {a.failed}</td>
                            <td className="pr-3">{failureRate(a)}%</td>
                            <td className="pr-3">{a.activities}</td>
                            <td className="pr-3">{a.rate_limited_7d}</td>
                            <td className="pr-3">{a.refreshes_7d}</td>
                            <td className={`pr-3 ${a.reuse_revocations ? `${TONES.bad} font-bold` : ''}`}>{a.reuse_revocations}</td>
                            <td>{a.last_upload_at ? formatDateTime(a.last_upload_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="md:hidden space-y-2">
                    {partner.apps.map((a) => (
                      <li key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                        <div className="flex justify-between gap-2">
                          <Link href="/admin/partner-apps" className="underline font-bold">{a.name}</Link>
                          <span className={`text-xs font-bold ${a.status === 'approved' ? (partnerAppHealth(a) === 'warn' ? TONES.warn : TONES.good) : muted}`}>{a.status === 'approved' && partnerAppHealth(a) === 'warn' ? 'check' : a.status}</span>
                        </div>
                        <Field label="Riders">{a.riders}</Field>
                        <Field label="24h / 7d / 30d / all">{a.uploads_24h} / {a.uploads_7d} / {a.uploads_30d} / {a.uploads_total}</Field>
                        <Field label="Imported / dup / failed">{a.imported} / {a.duplicate} / {a.failed}</Field>
                        <Field label="Fail %">{failureRate(a)}%</Field>
                        <Field label="Activities">{a.activities}</Field>
                        <Field label="429 7d">{a.rate_limited_7d}</Field>
                        <Field label="Refresh 7d">{a.refreshes_7d}</Field>
                        <Field label="Reuse" className={a.reuse_revocations ? TONES.bad : ''}>{a.reuse_revocations}</Field>
                        <Field label="Last upload">{a.last_upload_at ? formatDateTime(a.last_upload_at) : '—'}</Field>
                      </li>
                    ))}
                  </ul>
                  {partner.apps.length === 0 && <p className={`text-sm ${muted}`}>No apps registered yet.</p>}

                  <h3 className={subheading}>Recent upload failures</h3>
                  <ul className="text-sm divide-y divide-slate-200 dark:divide-slate-700">
                    {partner.recent_failures.map((f, i) => (
                      <li key={i} className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-3 py-2">
                        <span className="min-w-0 truncate" title={`${f.app} · ${f.message}`}><b>{f.app}</b> · {f.message}</span>
                        <span className={`font-mono text-xs sm:text-sm shrink-0 ${muted}`}>{formatDateTime(f.created_at)}</span>
                      </li>
                    ))}
                    {partner.recent_failures.length === 0 && <li className={`py-2 ${muted}`}>No failed uploads.</li>}
                  </ul>
                </Panel>
              </div>
            )}

            <div className="lg:col-span-2">
              <Panel title="Synchronisation" id="p-sync">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Connected accounts and sync health per provider</caption>
                    <thead className={`text-left text-xs font-bold ${muted} border-b border-slate-200 dark:border-slate-700`}>
                      <tr><th scope="col" className="py-2 pr-3">Provider</th><th scope="col" className="pr-3">Connected</th><th scope="col" className="pr-3">Errors</th><th scope="col" className="pr-3">Stale (3d+)</th><th scope="col" className="pr-3">Imported 24h / 7d</th><th scope="col" className="pr-3">Last sync</th><th scope="col">Health</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700 [&>tr:nth-child(even)]:bg-slate-50 dark:[&>tr:nth-child(even)]:bg-slate-800/40">
                      {withAllProviders(d.sync.providers).map((p) => {
                        const [text, tone] = HEALTH[providerHealth(p)]
                        return (
                          <tr key={p.provider}>
                            <td className="py-2 pr-3 font-black">{providerLabel(p.provider)}</td>
                            <td className="pr-3 font-mono">{p.connected}</td>
                            <td className={`pr-3 font-mono ${p.errors ? TONES.bad : ''}`}>{p.errors}</td>
                            <td className={`pr-3 font-mono ${p.stale ? TONES.warn : ''}`}>{p.stale}</td>
                            <td className="pr-3 font-mono">{p.imported_24h} / {p.imported_7d}</td>
                            <td className={`pr-3 ${muted}`}>{p.last_synced_at ? formatDateTime(p.last_synced_at) : '—'}</td>
                            <td className={`font-black ${tone}`}>{text}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden space-y-2">
                  {withAllProviders(d.sync.providers).map((p) => {
                    const [text, tone] = HEALTH[providerHealth(p)]
                    return (
                      <li key={p.provider} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                        <div className="flex justify-between gap-2"><b>{providerLabel(p.provider)}</b><span className={`font-black text-sm ${tone}`}>{text}</span></div>
                        <Field label="Connected">{p.connected}</Field>
                        <Field label="Errors" className={p.errors ? TONES.bad : ''}>{p.errors}</Field>
                        <Field label="Stale (3d+)" className={p.stale ? TONES.warn : ''}>{p.stale}</Field>
                        <Field label="Imported 24h / 7d">{p.imported_24h} / {p.imported_7d}</Field>
                        <Field label="Last sync">{p.last_synced_at ? formatDateTime(p.last_synced_at) : '—'}</Field>
                      </li>
                    )
                  })}
                </ul>
                <StatGrid cols="sm:grid-cols-4">
                  <Stat label="Garmin events 24h" value={d.sync.garmin_events.received_24h} />
                  <Stat label="Garmin events 7d" value={d.sync.garmin_events.received_7d} />
                  <Stat label="Last Garmin event" value={d.sync.garmin_events.last_received_at ? formatDateTime(d.sync.garmin_events.last_received_at) : '—'} />
                  {Object.entries(d.sync.garmin_events.by_status_7d || {}).map(([k, v]) => (
                    <Stat key={k} label={`Garmin ${k} 7d`} value={v} tone={k === 'error' && v ? 'bad' : undefined} />
                  ))}
                </StatGrid>
                <h3 className={subheading}>Recent connection errors</h3>
                <ul className="text-sm divide-y divide-slate-200 dark:divide-slate-700">
                  {d.sync.recent_errors.map((e) => (
                    <li key={`${e.provider}-${e.message}`} className="flex justify-between gap-3 py-2">
                      <span className="min-w-0 truncate" title={`${providerLabel(e.provider)} · ${e.message}`}><b>{providerLabel(e.provider)}</b> · {e.message}</span>
                      <span className={`font-mono shrink-0 ${muted}`}>×{e.count}</span>
                    </li>
                  ))}
                  {d.sync.recent_errors.length === 0 && <li className={`py-2 ${muted}`}>No connections in an error state.</li>}
                </ul>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
