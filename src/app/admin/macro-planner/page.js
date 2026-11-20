'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPage, AdminMessage, adminCard, adminMuted, adminBtn, adminInput } from '../../../components/admin/AdminUi'
import { supabase } from '../../../lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Feature flag `macro_planner`: off for everyone unless the global switch or the allow-list says otherwise.
export default function AdminMacroPlannerPage() {
  const [status, setStatus] = useState(null)
  const [denied, setDenied] = useState(false)
  const [userId, setUserId] = useState('')
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_macro_planner_status')
    if (err) return setDenied(true)
    setStatus(data)
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn, args) => {
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) setError('Could not save the change.')
    load()
  }

  if (denied) return <AdminMessage>Admins only.</AdminMessage>
  if (!status) return <AdminMessage>Loading…</AdminMessage>

  const valid = UUID_RE.test(userId.trim())
  return (
    <AdminPage title="Macro planner" description="Feature flag for the coach macro planner (long-term race planning). Off by default; enable per account via the allow-list.">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Global switch</h2>
        <p className={`text-sm ${adminMuted}`}>
          Currently <strong>{status.global_enabled ? 'on for everyone' : 'off'}</strong>.
        </p>
        <button
          className={status.global_enabled ? adminBtn.danger : adminBtn.primary}
          onClick={() => run('admin_set_macro_planner_global', { p_enabled: !status.global_enabled })}
        >
          {status.global_enabled ? 'Turn off globally' : 'Turn on globally'}
        </button>
      </section>
      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Allow-list</h2>
        <ul className="space-y-2">
          {status.allowlist.length === 0 && <li className={`text-sm ${adminMuted}`}>Nobody yet.</li>}
          {status.allowlist.map((a) => (
            <li key={a.user_id} className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm text-slate-900 dark:text-white break-all">{a.display_name || a.user_id}</span>
              <button className={adminBtn.secondary} onClick={() => run('admin_macro_planner_allow', { p_user: a.user_id, p_allowed: false })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 flex-wrap">
          <input className={`${adminInput} max-w-md`} placeholder="User id (uuid)" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <button
            className={adminBtn.primary}
            disabled={!valid}
            onClick={async () => { await run('admin_macro_planner_allow', { p_user: userId.trim(), p_allowed: true }); setUserId('') }}
          >
            Add
          </button>
        </div>
      </section>
    </AdminPage>
  )
}
