'use client'

import { useEffect, useState } from 'react'
import { adminCard, adminMuted, adminBtn } from './admin/AdminUi'
import { FEE_BREAKDOWN, STRIPE_SETUP_STEPS } from '../lib/coachPlans'
import { CONNECT_COUNTRIES, guessConnectCountry, connectStateLabel, fetchBillingStatus, startConnectOnboarding, subscriptionStatusLabel } from '../lib/coachBilling'

// Coach side of payments: Stripe Connect onboarding state and a read-only list of paying athletes.
// Coaching is never gated by payment; this is information for the coach.
export default function CoachBillingPanel() {
  const [s, setS] = useState(undefined)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [country, setCountry] = useState('')
  useEffect(() => { fetchBillingStatus().then(setS); setCountry(guessConnectCountry(navigator.language) || '') }, [])
  if (!s) return null

  const connect = async () => {
    setBusy(true); setMsg(null)
    const r = await startConnectOnboarding(country)
    if (r.url) window.location.assign(r.url)
    else { setMsg(r.error); setBusy(false) }
  }
  return (
    <section className={`${adminCard} space-y-3`}>
      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Payments (test mode)</h2>
      <p className={`text-sm ${adminMuted}`}>
        Athletes pay you directly through Stripe once you have accepted them. Stripe handles identity checks and payouts. Access to coaching is never blocked by payment.
      </p>
      <details className="text-sm" data-testid="payments-explainer">
        <summary className="cursor-pointer font-bold text-slate-900 dark:text-white">How payments and fees work</summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1 text-slate-800 dark:text-slate-200">{STRIPE_SETUP_STEPS.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="mt-3 font-bold text-slate-900 dark:text-white">Who pays which fee</p>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-800 dark:text-slate-200">{FEE_BREAKDOWN.map((x) => <li key={x}>{x}</li>)}</ul>
      </details>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{connectStateLabel(s)}</p>
      {s.configured && !s.connected && (
        <label className="block text-sm font-semibold text-slate-900 dark:text-white">
          Country where you operate
          <select value={country} onChange={(e) => setCountry(e.target.value)} required data-testid="connect-country" className="mt-1 block rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
            <option value="">Choose your country</option>
            {Object.entries(CONNECT_COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
      )}
      {s.configured && !(s.charges_enabled && s.payouts_enabled) && (
        <button type="button" disabled={busy || (!s.connected && !country)} onClick={connect} className={adminBtn.primary}>
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
