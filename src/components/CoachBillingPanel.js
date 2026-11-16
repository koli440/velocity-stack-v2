'use client'

import { useEffect, useState } from 'react'
import { connectStateLabel, fetchBillingStatus, startConnectOnboarding, subscriptionStatusLabel } from '../lib/coachBilling'

// Coach side of payments: Stripe Connect onboarding state and a read-only list of paying athletes.
// Coaching is never gated by payment; this is information for the coach.
export default function CoachBillingPanel() {
  const [s, setS] = useState(undefined)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchBillingStatus().then(setS) }, [])
  if (!s) return null

  const connect = async () => {
    setBusy(true); setMsg(null)
    const r = await startConnectOnboarding()
    if (r.url) window.location.assign(r.url)
    else { setMsg(r.error); setBusy(false) }
  }
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
      <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Payments (test mode)</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Athletes pay you directly through Stripe once you have accepted them. Stripe handles identity checks and payouts. Access to coaching is never blocked by payment.
      </p>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{connectStateLabel(s)}</p>
      {s.configured && !(s.charges_enabled && s.payouts_enabled) && (
        <button type="button" disabled={busy} onClick={connect} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-bold disabled:opacity-50">
          {s.connected ? 'Continue setup' : 'Set up payments'}
        </button>
      )}
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      {s.subscriptions?.length > 0 && (
        <ul className="text-sm divide-y divide-slate-200 dark:divide-slate-800">
          {s.subscriptions.map((x) => (
            <li key={x.id} className="py-1.5 flex justify-between gap-2">
              <span>{x.package_title || 'Package'}</span>
              <span className={x.status === 'past_due' || x.status === 'unpaid' ? 'font-bold text-amber-600' : ''}>
                {subscriptionStatusLabel(x.status)}{x.cancel_at_period_end ? ' · ends at period end' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
