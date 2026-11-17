import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { accountStatusFlags, buildAccountV2Params, createCoachAccountV2, createOnboardingLink, stripeV2Fetch, buildCheckoutParams, ensureConnectedCustomer, encodeForm, handleStripeEvent, planStripeEvent, stripeConfig, stripeFetch, verifyStripeSignature } from '../server/stripe.js'
import { billingErrorMessage, connectStateLabel } from '../coachBilling.js'
import { describeNotification, notificationHref } from '../notifications.js'

const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`
const META = { coach_id: ID(1), rider_id: ID(2), relationship_id: ID(3), package_id: ID(4) }

test('stripeConfig is test-mode only and never exposes live keys', () => {
  assert.equal(stripeConfig({}).enabled, false)
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_abc123' }).enabled, false)
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_abc123' }).secretKey, null)
  const c = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_APPLICATION_FEE_PERCENT: '10' })
  assert.deepEqual([c.enabled, c.applicationFeePercent], [true, 10])
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_APPLICATION_FEE_PERCENT: '90' }).applicationFeePercent, 0)
})

test('stripeFetch refuses when disabled and encodes nested params', async () => {
  await assert.rejects(() => stripeFetch(stripeConfig({}), 'POST', '/v1/x'), /not configured/)
  assert.equal(encodeForm({ a: { b: [{ c: 1 }] }, skip: null }).join('&'), 'a%5Bb%5D%5B0%5D%5Bc%5D=1')
  let seen
  const f = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id: 'x' }) } }
  await stripeFetch(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' }), 'POST', '/v1/accounts', { type: 'express' }, { idempotencyKey: 'k1', fetchImpl: f })
  assert.equal(seen.init.headers['Idempotency-Key'], 'k1')
  assert.equal(seen.init.body, 'type=express')
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Nope' } }) })
  await assert.rejects(() => stripeFetch(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' }), 'GET', '/v1/x', {}, { fetchImpl: bad }), /Nope/)
})

test('verifyStripeSignature: valid, tampered, stale, malformed', () => {
  const body = '{"id":"evt_1"}'
  const now = 1_800_000_000_000
  const t = Math.floor(now / 1000)
  const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex')
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', { now }), true)
  assert.equal(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_x', { now }), false)
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_y', { now }), false)
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', { now: now + 600_000 }), false)
  assert.equal(verifyStripeSignature(body, `t=${t},v1=abc`, 'whsec_x', { now }), false)
  assert.equal(verifyStripeSignature(body, 'garbage', 'whsec_x', { now }), false)
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, '', { now }), false)
})

test('planStripeEvent maps fixture events', () => {
  assert.deepEqual(planStripeEvent({ id: 'e', type: 'account.updated', data: { object: { id: 'acct_1', charges_enabled: true, payouts_enabled: false, details_submitted: true, country: 'DE' } } }),
    { rpc: 'billing_apply_account', args: { p_account: 'acct_1', p_charges: true, p_payouts: false, p_details: true, p_country: 'DE' } })
  const sub = planStripeEvent({ id: 'e', type: 'customer.subscription.updated', account: 'acct_1', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_800_000_000, cancel_at_period_end: true, metadata: META } } })
  assert.equal(sub.args.p_coach, ID(1)); assert.equal(sub.args.p_cancel_at_end, true); assert.match(sub.args.p_period_end, /^2027-/)
  const del = planStripeEvent({ id: 'e', type: 'customer.subscription.deleted', account: 'acct_1', data: { object: { id: 'sub_1', status: 'active', metadata: META } } })
  assert.equal(del.args.p_status, 'canceled')
  const forged = planStripeEvent({ id: 'e', type: 'customer.subscription.created', account: 'acct_1', data: { object: { id: 'sub_1', status: 'active', metadata: { coach_id: 'x; drop', rider_id: ID(2) } } } })
  assert.equal(forged.args.p_coach, null)
  assert.equal(planStripeEvent({ id: 'e', type: 'customer.subscription.created', account: 'acct_1', data: { object: { id: 's', status: 'weird' } } }), null)
  const paid = planStripeEvent({ id: 'evt_p', type: 'invoice.paid', account: 'acct_1', data: { object: { subscription: 'sub_1', amount_paid: 9000, currency: 'eur' } } })
  assert.deepEqual([paid.args.p_kind, paid.args.p_amount, paid.args.p_event], ['payment', 9000, 'evt_p'])
  assert.equal(planStripeEvent({ id: 'e', type: 'invoice.payment_failed', account: 'acct_1', data: { object: { subscription: 'sub_1', amount_due: 9000, currency: 'eur' } } }).args.p_kind, 'failed')
  assert.equal(planStripeEvent({ id: 'e', type: 'invoice.paid', data: { object: { amount_paid: 1 } } }), null)
  assert.equal(planStripeEvent({ id: 'e', type: 'checkout.session.completed', data: { object: { mode: 'subscription' } } }), null)
  assert.equal(planStripeEvent({ id: 'e', type: 'checkout.session.completed', account: 'acct_1', data: { object: { mode: 'payment', payment_status: 'paid', amount_total: 5000, currency: 'eur' } } }).args.p_account, 'acct_1')
  assert.equal(planStripeEvent({ id: 'e', type: 'charge.refunded', account: 'acct_1', data: { object: { amount_refunded: 100, currency: 'eur' } } }).args.p_kind, 'refund')
  assert.equal(planStripeEvent({ id: 'e', type: 'something.else', data: { object: {} } }), null)
  assert.equal(planStripeEvent(null), null)
})

test('handleStripeEvent is idempotent and retriable', async () => {
  const calls = []
  const mk = (isNew, failOn) => ({ rpc: async (n, a) => { calls.push(n); if (n === 'billing_record_event') return { data: isNew }; if (n === failOn) return { error: { message: 'boom' } }; return { data: true } } })
  const ev = { id: 'evt_1', type: 'account.updated', data: { object: { id: 'acct_1' } } }
  assert.deepEqual(await handleStripeEvent(mk(true), ev), { handled: true })
  assert.deepEqual(calls, ['billing_record_event', 'billing_apply_account', 'billing_finish_event'])
  calls.length = 0
  assert.deepEqual(await handleStripeEvent(mk(false), ev), { handled: false, duplicate: true })
  assert.deepEqual(calls, ['billing_record_event'])
  calls.length = 0
  await assert.rejects(() => handleStripeEvent(mk(true, 'billing_apply_account'), ev), /boom/)
  assert.ok(calls.includes('billing_forget_event'))
  assert.deepEqual(await handleStripeEvent(mk(true), { id: 'x', type: 'ping', data: { object: {} } }), { handled: false })
})

test('buildCheckoutParams: direct charges, metadata, optional fee', () => {
  const ctx = { coach_id: ID(1), relationship_id: ID(3), package_id: ID(4), stripe_account_id: 'acct_1', title: 'Plan', kind: 'subscription', interval: 'quarter', amount_cents: 9000, currency: 'eur' }
  const p = buildCheckoutParams(ctx, ID(2), 'https://x.test', 0)
  assert.equal(p.mode, 'subscription')
  assert.deepEqual(p.line_items[0].price_data.recurring, { interval: 'month', interval_count: 3 })
  assert.equal(p.subscription_data.transfer_data, undefined)
  assert.equal(p.customer, undefined)
  assert.equal(buildCheckoutParams(ctx, ID(2), 'https://x.test', 0, 'cus_1').customer, 'cus_1')
  assert.equal(p.subscription_data.application_fee_percent, undefined)
  assert.equal(p.subscription_data.metadata.rider_id, ID(2))
  assert.equal(buildCheckoutParams(ctx, ID(2), 'https://x.test', 10).subscription_data.application_fee_percent, 10)
  const one = buildCheckoutParams({ ...ctx, kind: 'one_time', interval: null }, ID(2), 'https://x.test', 10)
  assert.equal(p.subscription_data.trial_period_days, undefined)
  assert.equal(buildCheckoutParams({ ...ctx, trial_days: 14 }, ID(2), 'https://x.test', 0).subscription_data.trial_period_days, 14)
  assert.equal(buildCheckoutParams({ ...ctx, kind: 'one_time', trial_days: 14 }, ID(2), 'https://x.test', 0).payment_intent_data.trial_period_days, undefined)
  assert.equal(one.mode, 'payment')
  assert.equal(one.payment_intent_data.application_fee_amount, 900)
  assert.equal(one.metadata.destination, undefined)
  assert.equal(one.payment_intent_data.transfer_data, undefined)
})

test('billing labels, errors and notifications', () => {
  assert.match(connectStateLabel(null), /not available/)
  assert.equal(connectStateLabel({ configured: true, connected: false }), 'Not set up')
  assert.match(connectStateLabel({ configured: true, connected: true, charges_enabled: true, payouts_enabled: true }), /Ready/)
  assert.equal(billingErrorMessage('Payment opens once your coach has accepted you', 400), 'Payment opens once your coach has accepted you')
  assert.doesNotMatch(billingErrorMessage('select * from secret', 400), /select/)
  assert.match(describeNotification({ type: 'payment_failed', actor_nickname: 'Sam' }), /failed/)
  assert.equal(notificationHref({ type: 'subscription_started' }), '/settings/coach-card')
  assert.match(describeNotification({ type: 'payment_requested', actor_nickname: 'Sam' }), /pay for your plan/)
  assert.equal(notificationHref({ type: 'payment_requested' }), '/settings#coaching')
})

test('direct charges: Stripe-Account header on connected-account calls', async () => {
  const cfg = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' })
  let seen
  const f = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id: 'cus_1' }) } }
  await stripeFetch(cfg, 'POST', '/v1/checkout/sessions', {}, { stripeAccount: 'acct_1', fetchImpl: f })
  assert.equal(seen.init.headers['Stripe-Account'], 'acct_1')
  await stripeFetch(cfg, 'POST', '/v1/accounts', {}, { fetchImpl: f })
  assert.equal(seen.init.headers['Stripe-Account'], undefined)
  await assert.rejects(() => stripeFetch(cfg, 'POST', '/v1/x', {}, { stripeAccount: 'cus_evil', fetchImpl: f }), /Invalid payment account/)
})

test('connect webhooks need the account; account.updated falls back to the object id', () => {
  const inv = { id: 'e', type: 'invoice.paid', data: { object: { subscription: 'sub_1', amount_paid: 1, currency: 'eur' } } }
  assert.equal(planStripeEvent(inv), null)
  assert.equal(planStripeEvent({ ...inv, account: 'bad id' }), null)
  assert.equal(planStripeEvent({ ...inv, account: 'acct_9' }).args.p_account, 'acct_9')
  assert.equal(planStripeEvent({ id: 'e', type: 'account.updated', account: 'acct_9', data: { object: { id: 'acct_9' } } }).args.p_account, 'acct_9')
  assert.equal(planStripeEvent({ id: 'e', type: 'account.updated', data: { object: { id: 'acct_8' } } }).args.p_account, 'acct_8')
  const sub = planStripeEvent({ id: 'e', type: 'customer.subscription.updated', account: 'acct_9', data: { object: { id: 'sub_1', status: 'active', metadata: { coach_id: ID(1) } } } })
  assert.equal(sub.args.p_account, 'acct_9')
})

test('ensureConnectedCustomer: one customer per coach account and rider, created on the connected account', async () => {
  const cfg = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' })
  const ctx = { coach_id: ID(1), stripe_account_id: 'acct_1' }
  const calls = []
  const svc = (existing) => ({ rpc: async (n, a) => { calls.push([n, a]); return n === 'billing_get_customer' ? { data: existing } : { data: a.p_customer } } })
  assert.equal(await ensureConnectedCustomer(cfg, svc('cus_old'), ctx, ID(2)), 'cus_old')
  assert.equal(calls.length, 1)
  let seen
  const f = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id: 'cus_new' }) } }
  assert.equal(await ensureConnectedCustomer(cfg, svc(null), ctx, ID(2), { fetchImpl: f }), 'cus_new')
  assert.equal(seen.init.headers['Stripe-Account'], 'acct_1')
  assert.match(seen.init.headers['Idempotency-Key'], /^cus-acct_1-/)
  assert.deepEqual(calls.at(-1), ['billing_set_customer', { p_coach: ID(1), p_rider: ID(2), p_customer: 'cus_new' }])
})

test('Accounts v2: no legacy type, Stripe collects losses, merchant card payments', () => {
  const p = buildAccountV2Params({ coachId: ID(1), email: 'c@x.test', country: 'DE' })
  assert.equal(p.type, undefined)
  assert.equal(p.defaults.responsibilities.losses_collector, 'stripe')
  assert.equal(p.defaults.responsibilities.fees_collector, 'stripe')
  assert.equal(p.dashboard, 'express')
  assert.equal(p.configuration.merchant.capabilities.card_payments.requested, true)
  assert.equal(p.identity.country, 'de')
  assert.equal(p.metadata.coach_id, ID(1))
})

test('createCoachAccountV2 uses /v2 JSON with version header and falls back to the full dashboard', async () => {
  const cfg = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' })
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? { ok: false, status: 400, json: async () => ({ error: { message: 'preview' } }) } : { ok: true, json: async () => ({ id: 'acct_v2' }) }
  }
  const a = await createCoachAccountV2(cfg, { coachId: ID(1), country: 'DE' }, { fetchImpl: f })
  assert.equal(a.id, 'acct_v2')
  assert.equal(calls[0].url, 'https://api.stripe.com/v2/core/accounts')
  assert.match(calls[0].init.headers['Stripe-Version'], /preview$/)
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(JSON.parse(calls[1].init.body).dashboard, 'full')
  assert.doesNotMatch(calls[1].init.headers['Stripe-Version'], /preview/)
  await assert.rejects(() => stripeV2Fetch(stripeConfig({}), 'GET', '/v2/x'), /not configured/)
})

test('onboarding link: v2 account link, v1 fallback for legacy accounts', async () => {
  const cfg = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_k' })
  const urls = []
  const ok = async (url, init) => { urls.push(url); return { ok: true, json: async () => ({ url: 'https://stripe.test/l' }) } }
  assert.equal(await createOnboardingLink(cfg, 'acct_1', 'https://x.test', { fetchImpl: ok }), 'https://stripe.test/l')
  assert.deepEqual(urls, ['https://api.stripe.com/v2/core/account_links'])
  urls.length = 0
  const legacy = async (url) => { urls.push(url); return urls.length === 1 ? { ok: false, status: 400, json: async () => ({}) } : { ok: true, json: async () => ({ url: 'u1' }) } }
  assert.equal(await createOnboardingLink(cfg, 'acct_1', 'https://x.test', { fetchImpl: legacy }), 'u1')
  assert.equal(urls[1], 'https://api.stripe.com/v1/account_links')
})

test('account status flags for v2 and v1 accounts; thin v2 events sync through a fetch', async () => {
  const v2 = { object: 'v2.core.account', identity: { country: 'de' }, configuration: { merchant: { capabilities: { card_payments: { status: 'active' }, stripe_balance: { payouts: { status: 'active' } } } } }, requirements: { entries: [] } }
  assert.deepEqual(accountStatusFlags(v2), { charges: true, payouts: true, details: true, country: 'DE' })
  assert.equal(accountStatusFlags({ ...v2, configuration: { merchant: { capabilities: { card_payments: { status: 'restricted' } } } } }).charges, false)
  assert.equal(accountStatusFlags({ object: 'account', charges_enabled: true }).charges, true)
  const thin = { id: 'evt_t', type: 'v2.core.account[configuration.merchant].capability_status_updated', related_object: { id: 'acct_v2' } }
  assert.deepEqual(planStripeEvent(thin), { sync_account: 'acct_v2' })
  const calls = []
  const svc = { rpc: async (n, a) => { calls.push([n, a]); return { data: true } } }
  await handleStripeEvent(svc, thin, async () => ({ charges: true, payouts: false, details: true, country: 'DE' }))
  assert.deepEqual(calls.map((c) => c[0]), ['billing_record_event', 'billing_apply_account', 'billing_finish_event'])
  assert.equal(calls[1][1].p_charges, true)
})
