'use client'

// "Connected apps": partner apps (e.g. indoor-cycling games) the rider authorised through our OAuth provider.
// Self-contained; renders nothing until at least one app is connected.

import { useCallback, useEffect, useState } from 'react'
import { getAuthHeader } from '../lib/supabase'
import { SCOPE_LABELS } from '../lib/partnerScopes'
import { formatDateTime } from '../lib/dateFormat'

const CARD = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-3 space-y-2'

export default function ConnectedAppsCard() {
  const [apps, setApps] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/connected-apps', { headers: await getAuthHeader(), cache: 'no-store' })
      if (res.ok) setApps((await res.json()).apps || [])
    } catch {
      // the card simply stays hidden
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function disconnect(app) {
    if (!window.confirm(`Disconnect ${app.name}? It will no longer be able to upload to your account. Rides it already uploaded stay.`)) return
    setBusy(app.app_id)
    setError('')
    try {
      const res = await fetch(`/api/connected-apps/${app.app_id}`, { method: 'DELETE', headers: await getAuthHeader() })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Could not disconnect. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!apps.length) return null
  return (
    <div className={CARD} data-testid="connected-apps">
      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Connected apps</span>
      <p className="text-[11px] text-slate-400">Apps you allowed to send rides to Velocity Stack.</p>
      {apps.map((app) => (
        <div key={app.app_id} className="flex items-start justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{app.name}</div>
            <div className="text-[11px] text-slate-400">
              {(app.scopes || []).map((s) => SCOPE_LABELS[s] || s).join(' · ')}
            </div>
            <div className="text-[10px] text-slate-400">
              Connected {formatDateTime(app.connected_at)}{app.last_used_at ? ` · last used ${formatDateTime(app.last_used_at)}` : ''}
            </div>
          </div>
          <button type="button" disabled={busy === app.app_id} onClick={() => disconnect(app)} className="text-[11px] font-bold uppercase text-red-500 hover:underline disabled:opacity-50">
            {busy === app.app_id ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ))}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
