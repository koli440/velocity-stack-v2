'use client'

import { useState } from 'react'
import { startCheckout } from '../lib/coachBilling'

// Shown on paid packages of the public card. The server decides whether the visitor may pay
// (signed in, accepted by this coach, coach ready, not a minor) and returns a readable reason otherwise.
export default function BuyPackageButton({ packageId }) {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true); setMsg(null)
    const r = await startCheckout(packageId)
    if (r.url) window.location.assign(r.url)
    else { setMsg(r.error); setBusy(false) }
  }
  return (
    <div className="mt-2">
      <button type="button" disabled={busy} onClick={go} className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold disabled:opacity-50">Pay with Stripe</button>
      {msg && <p role="alert" className="text-xs text-red-600 mt-1">{msg}</p>}
    </div>
  )
}
