import { paymentBadge } from '../lib/paymentStatus'

const TONES = {
  ok: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700',
  info: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/40 dark:text-sky-100 dark:border-sky-700',
  warn: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-700',
  muted: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600',
}

// Small status chip ("Paid", "Payment due", "Free period until…"); renders nothing when there is no payment relationship.
export default function PaymentBadge({ sub, due = false }) {
  const b = paymentBadge(sub, due)
  if (!b) return null
  return <span data-testid="payment-badge" className={`inline-block px-2 py-0.5 rounded-full border text-xs font-bold ${TONES[b.tone]}`}>{b.label}</span>
}
