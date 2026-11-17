'use client'

import { useState } from 'react'
import PaymentBadge from './PaymentBadge'
import { lastPaymentText, paymentSentence, paymentStatusLine } from '../lib/paymentStatus'
import { openBillingPortal } from '../lib/coachBilling'

// Per-relationship payment card. role 'rider': "You pay <coach> …" with a Manage payment (Stripe portal) button;
// role 'coach': "<athlete> pays you …" with status, next payment and the last payment result.
export default function PaymentStatusCard({ role, name, sub, counterpartyId }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!sub) return null
  const manage = async () => {
    setBusy(true); setErr(null)
    const r = await openBillingPortal(counterpartyId)
    if (r.url) return window.location.assign(r.url)
    setErr(r.error); setBusy(false)
  }
  const last = lastPaymentText(sub.last_payment)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1" data-testid="payment-status-card">
      <p className="text-sm font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
        {paymentSentence(role, name, sub)} <PaymentBadge sub={sub} />
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-300">{paymentStatusLine(sub)}</p>
      {last && <p className="text-xs text-slate-600 dark:text-slate-300">Last payment: {last}</p>}
      {role === 'rider' && sub.status !== 'canceled' && (
        <button type="button" disabled={busy} onClick={manage} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          {busy ? 'Opening…' : 'Manage payment'}
        </button>
      )}
      {err && <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">{err}</p>}
    </div>
  )
}
