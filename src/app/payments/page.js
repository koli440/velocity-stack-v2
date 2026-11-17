'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchPayments } from '../../lib/coachBilling'
import { fetchProfilesByIds, authorName } from '../../lib/social'
import { formatMoney, ledgerKindLabel, monthTotalText } from '../../lib/paymentStatus'
import { AdminPage, ErrorNote, adminCard, adminMuted } from '../../components/admin/AdminUi'

function Ledger({ title, role, data, profiles, testId }) {
  return (
    <section className={`${adminCard} space-y-2`} data-testid={testId}>
      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{title}</h2>
      <p className="text-sm font-semibold text-slate-900 dark:text-white" data-testid={`${testId}-month`}>
        This month ({role === 'coach' ? 'gross, before Stripe fees' : 'paid'}): {monthTotalText(data.totals)}
      </p>
      {role === 'coach' && <p className={`text-xs ${adminMuted}`}>Stripe's fees are taken by Stripe and are not tracked here; see your Stripe dashboard for the exact net amounts.</p>}
      {!data.rows.length ? <p className={`text-sm ${adminMuted}`}>No payments yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead><tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300"><th className="py-1 pr-3">Date</th><th className="pr-3">{role === 'coach' ? 'Athlete' : 'Coach'}</th><th className="pr-3">Package</th><th className="pr-3">Amount</th><th className="pr-3">Status</th><th>Receipt</th></tr></thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.rows.map((r) => (
                <tr key={r.id} className="text-slate-900 dark:text-slate-100">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="pr-3">{r.counterparty_id ? authorName(profiles.get(r.counterparty_id)) : 'Former member'}</td>
                  <td className="pr-3">{r.package_title || '–'}</td>
                  <td className="pr-3 whitespace-nowrap">{formatMoney(r.amount_cents, r.currency)}</td>
                  <td className={`pr-3 ${r.kind === 'failed' ? 'font-bold text-amber-700 dark:text-amber-300' : ''}`}>{ledgerKindLabel(r.kind)}</td>
                  <td>{r.receipt_url ? <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="underline text-orange-700 dark:text-orange-400">Receipt</a> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// My payments (what I pay my coach) and Payments received (what athletes pay me). Owner-scoped RPCs; no card data.
export default function PaymentsPage() {
  const router = useRouter()
  const [state, setState] = useState({ loading: true, rider: null, coach: null, profiles: new Map(), error: false })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const [rider, coach] = await Promise.all([fetchPayments(supabase, 'rider'), fetchPayments(supabase, 'coach')])
      const { profiles } = await fetchProfilesByIds(supabase, [...rider.rows, ...coach.rows].map((r) => r.counterparty_id))
      if (!cancelled) setState({ loading: false, rider, coach, profiles, error: !!(rider.error && coach.error) })
    })()
    return () => { cancelled = true }
  }, [router])
  const { rider, coach, profiles } = state
  return (
    <AdminPage title="Payments" description="Who you pay and who pays you for coaching. Card details are never shown here." back={{ href: '/settings', label: 'Settings' }} width="max-w-4xl">
      <div className="space-y-4" data-testid="payments-page">
        {state.loading && <p className={`text-sm ${adminMuted}`} role="status">Loading…</p>}
        {state.error && <ErrorNote>Could not load payments.</ErrorNote>}
        {rider && (rider.rows.length > 0 || !coach.rows.length) && <Ledger title="My payments" role="rider" data={rider} profiles={profiles} testId="my-payments" />}
        {coach && (coach.rows.length > 0 || !rider.rows.length) && <Ledger title="Payments received" role="coach" data={coach} profiles={profiles} testId="payments-received" />}
      </div>
    </AdminPage>
  )
}
