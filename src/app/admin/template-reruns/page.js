'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from '../../../components/Icon'
import { getAuthHeader, supabase } from '../../../lib/supabase'
import { formatDateTime } from '../../../lib/dateFormat'

const FILTERS = [['', 'All'], ['done', 'Re-run'], ['skipped', 'Skipped'], ['failed', 'Failed']]

function Count({ label, value, tone }) {
  return (
    <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-surface-darkBorder min-w-[7rem]">
      <div className="text-[10px] uppercase font-bold text-slate-400">{label}</div>
      <div className={`text-lg font-black ${tone || 'text-slate-900 dark:text-white'}`}>{value ?? '—'}</div>
    </div>
  )
}

export default function AdminTemplateRerunsPage() {
  const [admin, setAdmin] = useState(null)
  const [data, setData] = useState(null)
  const [dry, setDry] = useState(false)
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/template-rerun?${dry ? 'dry=1&' : ''}${status ? `status=${status}` : ''}`, { headers: await getAuthHeader() })
    if (res.ok) setData(await res.json())
    else setMessage((await res.json().catch(() => ({}))).error || 'Could not load')
  }, [dry, status])

  useEffect(() => {
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id
      const { data: prof } = uid ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle() : { data: null }
      setAdmin(!!prof?.is_admin)
    })()
  }, [])

  useEffect(() => {
    if (!admin) return undefined
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [admin, load])

  const act = async (action) => {
    setBusy(true)
    const res = await fetch('/api/admin/template-rerun', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) }, body: JSON.stringify({ action }) })
    const body = await res.json().catch(() => ({}))
    setMessage(body.message || body.error || (body.paused ? 'Paused.' : ''))
    if (action === 'dry_run') setDry(true)
    if (action === 'start') setDry(false)
    setBusy(false)
    load()
  }

  if (admin === null) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  const c = data?.counts
  const control = c?.control
  const running = control?.state === 'running'
  const btn = 'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50'

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Template run re-run</h1>
        <Link href="/admin/suggestions" className="text-xs underline text-slate-500">Suggestions</Link>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Re-runs every stored template run with the current detection so old runs gain the per-effort fields. Previous efforts and summaries are backed up first;
        activity link, owner, dates and coach stamps are preserved; PB Vault is untouched. Start a dry run to preview, then Start to apply. It continues in the
        background (every 5 minutes and chained) and can be paused and resumed.
      </p>

      <div className="flex flex-wrap gap-2" aria-live="polite">
        <Count label="Total runs" value={c?.total_runs} />
        <Count label="Lacking per-effort data" value={c?.without_per_effort} tone="text-amber-500" />
        <Count label="Re-run" value={c?.done} tone="text-emerald-500" />
        <Count label="Skipped" value={c?.skipped} />
        <Count label="Failed" value={c?.failed} tone={c?.failed ? 'text-red-500' : undefined} />
        <Count label="Backed up / verified" value={c ? `${c.backed_up} / ${c.verified}` : null} />
      </div>
      <p className="text-xs text-slate-400">
        State: <b>{control?.state || '—'}</b>
        {control?.state !== 'idle' && control?.mode ? ` (${control.mode === 'dry_run' ? 'dry run' : 'apply'})` : ''}
        {control?.baseline_taken_at ? ` · baseline at deploy: ${control.baseline_without_per_effort} of ${control.baseline_total} runs lacked per-effort data (${formatDateTime(control.baseline_taken_at)})` : ''}
        {control?.finished_at ? ` · last finished ${formatDateTime(control.finished_at)}` : ''}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || running} onClick={() => act('dry_run')} className={`${btn} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>Dry run</button>
        <button type="button" disabled={busy || running} onClick={() => act('start')} className={`${btn} bg-orange-500 text-white`}>Start re-run</button>
        <button type="button" disabled={busy || !running} onClick={() => act('pause')} className={`${btn} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>Pause</button>
      </div>
      {message && <p role="status" className="text-xs font-bold text-slate-500">{message}</p>}

      <section aria-label="Report" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider">
          <button type="button" aria-pressed={!dry} onClick={() => setDry(false)} className={!dry ? 'text-orange-500' : 'text-slate-400'}>Real run</button>
          <button type="button" aria-pressed={dry} onClick={() => setDry(true)} className={dry ? 'text-orange-500' : 'text-slate-400'}>Dry run</button>
          <span className="text-slate-300">|</span>
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)} className={status === key ? 'text-orange-500' : 'text-slate-400'}>{label}</button>
          ))}
        </div>
        {dry && c && <p className="text-xs text-slate-500">Dry run: {c.dry_would_rerun} would be re-run, {c.dry_skipped} skipped, {c.dry_failed} failed.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[34rem]">
            <caption className="sr-only">Per-run results of the template re-run job</caption>
            <thead className="text-left text-[10px] uppercase text-slate-400">
              <tr><th scope="col" className="py-1 pr-3">Status</th><th scope="col" className="pr-3">Template</th><th scope="col" className="pr-3">Efforts</th><th scope="col" className="pr-3">Reason</th><th scope="col">When</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data?.items || []).map((i) => (
                <tr key={`${i.execution_id}-${i.status}`}>
                  <td className={`py-1 pr-3 font-black ${i.status === 'failed' ? 'text-red-500' : i.status === 'done' ? 'text-emerald-500' : 'text-slate-500'}`}>{i.status}</td>
                  <td className="pr-3">{i.template_slug || '—'}{i.by_coach ? ' (coach run)' : ''}</td>
                  <td className="pr-3 font-mono">{i.efforts_before ?? '—'} → {i.efforts_after ?? '—'}</td>
                  <td className="pr-3">{i.reason || ''}{i.warning ? <> <Icon name="alert" /> {i.warning}</> : ''}</td>
                  <td className="text-slate-400">{formatDateTime(i.processed_at)}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && <tr><td colSpan={5} className="py-3 text-slate-400">No results yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
