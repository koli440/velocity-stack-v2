// Pure helpers for showing payments in the app (athlete: what I pay, coach: what I receive). No card data ever.

export function formatMoney(cents, currency) {
  if (!Number.isFinite(cents)) return ''
  const c = String(currency || 'eur').toUpperCase()
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: c }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${c}`
  }
}

const INTERVAL_SUFFIX = { month: '/month', quarter: '/quarter', year: '/year' }
export const intervalSuffix = (i) => INTERVAL_SUFFIX[i] || ''

export const priceText = (sub) => (Number.isFinite(sub?.amount_cents) ? `${formatMoney(sub.amount_cents, sub.currency)}${intervalSuffix(sub.interval)}` : '')

const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'])

/** The most relevant subscription per counterparty: a live one first, else the most recent (input is newest first). */
export function subscriptionsByCounterparty(list) {
  const map = new Map()
  for (const s of list || []) {
    const cur = map.get(s.counterparty_id)
    if (!cur || (!LIVE.has(cur.status) && LIVE.has(s.status))) map.set(s.counterparty_id, s)
  }
  return map
}

/** Short badge: { label, tone: 'ok' | 'info' | 'warn' | 'muted' } or null when there is nothing to show. */
export function paymentBadge(sub, due = false, now = Date.now()) {
  if (!sub) return due ? { label: 'Payment due', tone: 'warn' } : null
  switch (sub.status) {
    case 'trialing':
      return { label: sub.trial_end ? `Free period until ${dateText(sub.trial_end)}` : 'Free period', tone: 'info' }
    case 'active':
      return sub.cancel_at_period_end
        ? { label: `Paid · ends ${dateText(sub.current_period_end)}`, tone: 'ok' }
        : { label: 'Paid', tone: 'ok' }
    case 'past_due':
    case 'unpaid':
      return { label: 'Payment due', tone: 'warn' }
    case 'canceled':
      return due ? { label: 'Payment due', tone: 'warn' } : { label: 'Cancelled', tone: 'muted' }
    default:
      return { label: 'Payment pending', tone: 'muted' }
  }
}

export const lastPaymentText = (lp) => {
  if (!lp) return null
  const what = lp.kind === 'payment' ? 'Paid' : lp.kind === 'failed' ? 'Failed' : lp.kind === 'refund' ? 'Refunded' : 'Disputed'
  return `${what} ${formatMoney(lp.amount_cents, lp.currency)} on ${dateText(lp.at)}`
}

/** Sentence for the relationship card. role 'rider': I pay the coach; role 'coach': the athlete pays me. */
export function paymentSentence(role, name, sub) {
  const price = priceText(sub)
  const pkg = sub?.package_title ? ` for ${sub.package_title}` : ''
  if (role === 'rider') return `You pay ${name}${price ? ` ${price}` : ''}${pkg}`
  return `${name} pays you${price ? ` ${price}` : ''}${pkg}`
}

/** Status line with the next payment date. */
export function paymentStatusLine(sub) {
  if (!sub) return ''
  switch (sub.status) {
    case 'trialing':
      return `Free period${sub.trial_end ? ` until ${dateText(sub.trial_end)}` : ''}${sub.current_period_end ? ` · first payment ${dateText(sub.trial_end || sub.current_period_end)}` : ''}`
    case 'active':
      return sub.cancel_at_period_end ? `Active · ends ${dateText(sub.current_period_end)}` : `Active${sub.current_period_end ? ` · next payment ${dateText(sub.current_period_end)}` : ''}`
    case 'past_due':
      return 'Past due: the last payment did not go through'
    case 'unpaid':
      return 'Unpaid'
    case 'canceled':
      return 'Cancelled'
    case 'paused':
      return 'Paused'
    default:
      return 'Waiting for the first payment'
  }
}

export const ledgerKindLabel = (k) => ({ payment: 'Paid', failed: 'Failed', refund: 'Refunded', dispute: 'Disputed' })[k] || k

/** Month totals as text; fees are not part of the ledger, so only gross (and refunds) are shown. */
export function monthTotalText(totals) {
  const list = (totals || []).filter((t) => t.gross_cents || t.refunded_cents)
  if (!list.length) return 'Nothing this month'
  return list.map((t) => `${formatMoney(t.gross_cents, t.currency)}${t.refunded_cents ? ` (${formatMoney(t.refunded_cents, t.currency)} refunded)` : ''}`).join(' · ')
}

/** Notification text with counterparty and amount; null falls back to the generic wording. */
export function paymentNotificationText(n, name) {
  const info = n?.payment_info
  if (!info) return null
  const price = Number.isFinite(info.amount_cents) ? `${formatMoney(info.amount_cents, info.currency)}${intervalSuffix(info.interval)}` : ''
  const isRider = info.role === 'rider'
  switch (n.type) {
    case 'subscription_started':
      return `${name} started paying you${price ? ` ${price}` : ''}`
    case 'subscription_ended':
      return `${name} stopped paying you${price ? ` (${price})` : ''}`
    case 'payment_failed':
      return isRider ? `Your payment to ${name}${price ? ` (${price})` : ''} failed` : `${name}'s payment${price ? ` of ${price}` : ''} failed`
    default:
      return null
  }
}
