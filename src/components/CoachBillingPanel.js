'use client'

import { useEffect, useState } from 'react'
import { adminCard, adminMuted, adminBtn } from './admin/AdminUi'
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
    <section className={`${adminCard} space-y-3`}>
      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Payments (test mode)</h2>
      <p className={`text-sm ${adminMuted}`}>
        Athletes pay you directly through Stripe once you have accepted them. Stripe handles identity checks and payouts. Access to coaching is never blocked by payment.
      </p>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{connectStateLabel(s)}</p>
      {s.configured && !(s.charges_enabled && s.payouts_enabled) && (
        <button type="button" disabled={busy} onClick={connect} className={adminBtn.primary}>
          {s.connected ? 'Continue setup' : 'Set up payments'}
        </button>
      )}
      {msg && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{msg}</p>}
      {s.subscriptions?.length > 0 && (
        <ul className="text-sm divide-y divide-slate-200 dark:divide-slate-800">
          {s.subscriptions.map((x) => (
            <li key={x.id} className="py-1.5 flex justify-between gap-2">
              <span>{x.package_title || 'Package'}</span>
              <span className={x.status === 'past_due' || x.status === 'unpaid' ? 'font-bold text-amber-700 dark:text-amber-300' : ''}>
                {subscriptionStatusLabel(x.status)}{x.cancel_at_period_end ? ' · ends at period end' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
