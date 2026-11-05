'use client'

import { useCallback, useEffect, useState } from 'react'
import Icon from '../../../components/Icon'
import { getAuthHeader, supabase } from '../../../lib/supabase'
import { formatDateTime } from '../../../lib/dateFormat'
import SegmentedTabs from '../../../components/SegmentedTabs'
import { AdminPage, AdminMessage, EmptyState, StatusNote, StatusBadge, CountTile, Field, adminCard, adminMuted, adminBtn } from '../../../components/admin/AdminUi'

const FILTERS = [['', 'All'], ['done', 'Re-run'], ['skipped', 'Skipped'], ['failed', 'Failed']]

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

  if (admin === null) return <AdminMessage>Loading…</AdminMessage>
  if (!admin) return <AdminMessage>Admins only.</AdminMessage>

  const c = data?.counts
  const control = c?.control
  const running = control?.state === 'running'
  const items = data?.items || []

  return (
    <AdminPage
      title="Template run re-run"
      description="Re-runs every stored template run with the current detection so old runs gain the per-effort fields. Previous efforts and summaries are backed up first; activity link, owner, dates and coach stamps are preserved; PB Vault is untouched. Start a dry run to preview, then Start to apply. It continues in the background (every 5 minutes and chained) and can be paused and resumed."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-live="polite">
        <CountTile label="Total runs" value={c?.total_runs} />
        <CountTile label="Lacking per-effort data" value={c?.without_per_effort} tone="warn" />
        <CountTile label="Re-run" value={c?.done} tone="good" />
        <CountTile label="Skipped" value={c?.skipped} />
        <CountTile label="Failed" value={c?.failed} tone={c?.failed ? 'bad' : undefined} />
        <CountTile label="Backed up / verified" value={c ? `${c.backed_up} / ${c.verified}` : null} />
      </div>
      <p className={`text-sm ${adminMuted}`}>
        State: <b className="text-slate-900 dark:text-white">{control?.state || '—'}</b>
        {control?.state !== 'idle' && control?.mode ? ` (${control.mode === 'dry_run' ? 'dry run' : 'apply'})` : ''}
        {control?.baseline_taken_at ? ` · baseline at deploy: ${control.baseline_without_per_effort} of ${control.baseline_total} runs lacked per-effort data (${formatDateTime(control.baseline_taken_at)})` : ''}
        {control?.finished_at ? ` · last finished ${formatDateTime(control.finished_at)}` : ''}
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" disabled={busy || running} onClick={() => act('dry_run')} className={adminBtn.secondary}>Dry run</button>
        <button type="button" disabled={busy || running} onClick={() => act('start')} className={adminBtn.primary}>{busy ? 'Working…' : 'Start re-run'}</button>
        <button type="button" disabled={busy || !running} onClick={() => act('pause')} className={adminBtn.secondary}>Pause</button>
      </div>
      <StatusNote>{message}</StatusNote>

      <section aria-label="Report" className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <SegmentedTabs label="Run type" tabs={[['real', 'Real run'], ['dry', 'Dry run']]} value={dry ? 'dry' : 'real'} onChange={(k) => setDry(k === 'dry')} />
          <SegmentedTabs label="Status filter" tabs={FILTERS} value={status} onChange={setStatus} />
        </div>
        {dry && c && <p className={`text-sm ${adminMuted}`}>Dry run: {c.dry_would_rerun} would be re-run, {c.dry_skipped} skipped, {c.dry_failed} failed.</p>}
        {data && items.length === 0 && <EmptyState>No results yet.</EmptyState>}
        {items.length > 0 && (
          <>
            <div className={`${adminCard} hidden md:block overflow-x-auto`}>
              <table className="w-full text-sm">
                <caption className="sr-only">Per-run results of the template re-run job</caption>
                <thead className="text-left text-xs font-bold text-slate-600 dark:text-slate-300">
                  <tr><th scope="col" className="py-2 pr-3">Status</th><th scope="col" className="pr-3">Template</th><th scope="col" className="pr-3">Efforts</th><th scope="col" className="pr-3">Reason</th><th scope="col">When</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-slate-900 dark:text-white">
                  {items.map((i) => (
                    <tr key={`${i.execution_id}-${i.status}`} className="align-top">
                      <td className="py-2 pr-3"><StatusBadge status={i.status} /></td>
                      <td className="pr-3 py-2 break-words">{i.template_slug || '—'}{i.by_coach ? ' (coach run)' : ''}</td>
                      <td className="pr-3 py-2 font-mono whitespace-nowrap">{i.efforts_before ?? '—'} → {i.efforts_after ?? '—'}</td>
                      <td className="pr-3 py-2 break-words">{i.reason || ''}{i.warning ? <> <Icon name="alert" /> {i.warning}</> : ''}</td>
                      <td className={`py-2 ${adminMuted}`}>{formatDateTime(i.processed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden space-y-2">
              {items.map((i) => (
                <li key={`${i.execution_id}-${i.status}`} className={`${adminCard} space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={i.status} />
                    <span className={`text-xs ${adminMuted}`}>{formatDateTime(i.processed_at)}</span>
                  </div>
                  <Field label="Template">{i.template_slug || '—'}{i.by_coach ? ' (coach run)' : ''}</Field>
                  <Field label="Efforts"><span className="font-mono">{i.efforts_before ?? '—'} → {i.efforts_after ?? '—'}</span></Field>
                  {(i.reason || i.warning) && <Field label="Reason">{i.reason || ''}{i.warning ? <> <Icon name="alert" /> {i.warning}</> : ''}</Field>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </AdminPage>
  )
}
