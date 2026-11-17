// Stripe helpers for the coach module (phase 4). DIRECT charges: everything money-related is created ON the coach's
// connected account (Stripe-Account header); the platform never collects the payment (see docs/coach-billing.md). Secrets are read from the server environment only and are never
// stored, logged or returned. Test mode only: a key that is not a test key disables the integration.
import { createHmac, timingSafeEqual } from 'node:crypto'

export function stripeConfig(env = process.env) {
  const key = env.STRIPE_SECRET_KEY || ''
  const enabled = /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)
  const fee = Number(env.STRIPE_APPLICATION_FEE_PERCENT ?? 0)
  return {
    enabled,
    secretKey: enabled ? key : null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    connectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET || null,
    applicationFeePercent: Number.isFinite(fee) && fee >= 0 && fee <= 50 ? fee : 0,
  }
}

// application/x-www-form-urlencoded with Stripe's bracket notation for nested values.
export function encodeForm(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object') encodeForm(v, key, out)
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out
}

export const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/

// `stripeAccount` runs the call on that connected account (customers, checkout, portal, refunds, subscriptions).
export async function stripeFetch(cfg, method, path, params = {}, { idempotencyKey, stripeAccount, fetchImpl = fetch } = {}) {
  if (!cfg?.enabled) throw new Error('Payments are not configured')
  if (stripeAccount !== undefined && !ACCOUNT_ID.test(String(stripeAccount))) throw new Error('Invalid payment account')
  const headers = { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const form = encodeForm(params).join('&')
  const isGet = method === 'GET'
  const res = await fetchImpl(`https://api.stripe.com${path}${isGet && form ? `?${form}` : ''}`, {
    method, headers, body: isGet ? undefined : form,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ? `Stripe: ${json.error.message}` : `Stripe error ${res.status}`)
  return json
}

// Verifies the `Stripe-Signature` header (v1 HMAC-SHA256 of `${t}.${rawBody}`) with a replay tolerance.
export function verifyStripeSignature(rawBody, header, secret, { now = Date.now(), toleranceSec = 300 } = {}) {
  if (!rawBody || !header || !secret) return false
  const parts = String(header).split(',').map((p) => p.trim().split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  return sigs.some((s) => {
    const b = Buffer.from(s)
    return a.length === b.length && timingSafeEqual(a, b)
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOr = (v) => (typeof v === 'string' && UUID.test(v) ? v : null)
const iso = (s) => (Number.isFinite(s) ? new Date(s * 1000).toISOString() : null)
const SUB_STATUSES = new Set(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'])

// Pure mapping from a Stripe event to the database call it needs (or null when it is not relevant). Connect events carry
// `account` (the coach's connected account); the database resolves the coach from it, never from metadata.
export function planStripeEvent(event) {
  const o = event?.data?.object
  if (!event?.id || !event?.type || !o) return null
  const account = typeof event.account === 'string' && ACCOUNT_ID.test(event.account) ? event.account : null
  if (event.type === 'account.updated') {
    const id = account || (typeof o.id === 'string' && ACCOUNT_ID.test(o.id) ? o.id : null)
    if (!id) return null
    return { rpc: 'billing_apply_account', args: { p_account: id, p_charges: !!o.charges_enabled, p_payouts: !!o.payouts_enabled, p_details: !!o.details_submitted, p_country: o.country || null } }
  }
  if (!account) return null
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const m = o.metadata || {}
      const status = event.type.endsWith('deleted') ? 'canceled' : o.status
      if (!SUB_STATUSES.has(status)) return null
      const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end
      return { rpc: 'billing_apply_subscription', args: {
        p_sub: o.id, p_customer: typeof o.customer === 'string' ? o.customer : null, p_status: status, p_period_end: iso(end),
        p_cancel_at_end: !!o.cancel_at_period_end, p_coach: uuidOr(m.coach_id), p_rider: uuidOr(m.rider_id),
        p_relationship: uuidOr(m.relationship_id), p_package: uuidOr(m.package_id), p_account: account } }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const sub = o.subscription || o.parent?.subscription_details?.subscription
      if (typeof sub !== 'string') return null
      const paid = event.type === 'invoice.paid'
      return { rpc: 'billing_apply_payment', args: { p_event: event.id, p_sub: sub, p_kind: paid ? 'payment' : 'failed',
        p_amount: paid ? o.amount_paid : o.amount_due, p_currency: o.currency, p_fee: o.application_fee_amount ?? 0, p_account: account } }
    }
    case 'checkout.session.completed': {
      if (o.mode !== 'payment' || o.payment_status !== 'paid') return null
      return { rpc: 'billing_apply_payment', args: { p_event: event.id, p_sub: '', p_kind: 'payment', p_amount: o.amount_total,
        p_currency: o.currency, p_fee: 0, p_account: account } }
    }
    case 'charge.refunded':
      return { rpc: 'billing_apply_payment', args: { p_event: event.id, p_sub: '', p_kind: 'refund', p_amount: o.amount_refunded,
        p_currency: o.currency, p_fee: 0, p_account: account } }
    default:
      return null
  }
}

// Idempotent: a replayed event id is acknowledged without touching the data. A failed event is forgotten so the
// retry from Stripe is processed again. Only the event type and id are ever logged by callers.
export async function handleStripeEvent(service, event) {
  const plan = planStripeEvent(event)
  if (!plan) return { handled: false }
  const { data: isNew, error: e1 } = await service.rpc('billing_record_event', { p_id: event.id, p_type: event.type })
  if (e1) throw new Error(e1.message)
  if (!isNew) return { handled: false, duplicate: true }
  const { error } = await service.rpc(plan.rpc, plan.args)
  if (error) {
    await service.rpc('billing_forget_event', { p_id: event.id })
    throw new Error(error.message)
  }
  await service.rpc('billing_finish_event', { p_id: event.id, p_error: null })
  return { handled: true }
}

const INTERVALS = { month: ['month', 1], quarter: ['month', 3], year: ['year', 1] }

// Parameters for a Checkout Session created ON the coach's connected account (direct charge; send with
// stripeAccount = ctx.stripe_account_id). The optional platform fee is application_fee_percent / application_fee_amount.
// `customerId` is the rider's customer on that account (see ensureConnectedCustomer).
export function buildCheckoutParams(ctx, riderId, origin, feePercent = 0, customerId = null) {
  const meta = { coach_id: ctx.coach_id, rider_id: riderId, relationship_id: ctx.relationship_id, package_id: ctx.package_id }
  const price = { currency: ctx.currency, unit_amount: ctx.amount_cents, product_data: { name: ctx.title } }
  const base = {
    client_reference_id: riderId,
    success_url: `${origin}/settings/coach-card?payment=success`,
    cancel_url: `${origin}/settings/coach-card?payment=cancelled`,
    metadata: meta,
  }
  if (customerId) base.customer = customerId
  if (ctx.kind === 'subscription') {
    const [interval, count] = INTERVALS[ctx.interval] || INTERVALS.month
    const sub = { metadata: meta }
    if (feePercent > 0) sub.application_fee_percent = feePercent
    if (Number.isInteger(ctx.trial_days) && ctx.trial_days > 0) sub.trial_period_days = Math.min(ctx.trial_days, 90)
    return { ...base, mode: 'subscription', line_items: [{ quantity: 1, price_data: { ...price, recurring: { interval, interval_count: count } } }], subscription_data: sub }
  }
  const pi = { metadata: meta }
  if (feePercent > 0) pi.application_fee_amount = Math.round((ctx.amount_cents * feePercent) / 100)
  return { ...base, mode: 'payment', line_items: [{ quantity: 1, price_data: price }], payment_intent_data: pi }
}

// One Stripe customer per (coach account, rider), created on the connected account and remembered in the database.
export async function ensureConnectedCustomer(cfg, service, ctx, riderId, { fetchImpl } = {}) {
  const { data: existing } = await service.rpc('billing_get_customer', { p_coach: ctx.coach_id, p_rider: riderId })
  if (existing) return existing
  const created = await stripeFetch(cfg, 'POST', '/v1/customers', { metadata: { coach_id: ctx.coach_id, rider_id: riderId } },
    { idempotencyKey: `cus-${ctx.stripe_account_id}-${riderId}`, stripeAccount: ctx.stripe_account_id, fetchImpl })
  const { data, error } = await service.rpc('billing_set_customer', { p_coach: ctx.coach_id, p_rider: riderId, p_customer: created.id })
  if (error) throw new Error(error.message)
  return data || created.id
}
