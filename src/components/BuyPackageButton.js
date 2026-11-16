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
    <div className="pt-1">
      <button type="button" disabled={busy} onClick={go} className="inline-flex w-full sm:w-auto items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">{busy ? 'Opening checkout…' : 'Pay with Stripe'}</button>
      {msg && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300 mt-2">{msg}</p>}
    </div>
  )
}
