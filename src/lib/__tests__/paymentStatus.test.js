import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, priceText, paymentBadge, paymentSentence, paymentNotificationText } from '../paymentStatus.js'
import { withPaymentsItem, sidebarItems } from '../coachContext.js'
import { NAV_ITEMS } from '../navigation.js'

test('money and price text', () => {
  assert.match(formatMoney(5000, 'eur'), /50/)
  assert.match(priceText({ amount_cents: 5000, currency: 'eur', interval: 'month' }), /month/)
})

test('badge and sentence', () => {
  const sub = { status: 'active', amount_cents: 5000, currency: 'eur', interval: 'month', package_title: 'Pro' }
  assert.equal(paymentBadge(sub, false).label, 'Paid')
  assert.equal(paymentBadge(sub, true) === null, false)
  assert.match(paymentSentence('rider', 'Coach X', sub), /You pay Coach X/)
  assert.match(paymentSentence('coach', 'Jana', sub), /Jana pays you/)
})

test('notification names counterparty and amount', () => {
  const t = paymentNotificationText({ type: 'subscription_started', payment_info: { amount_cents: 5000, currency: 'eur', interval: 'month', role: 'coach' } }, 'Jana')
  assert.match(t, /Jana started paying you/)
  const f = paymentNotificationText({ type: 'payment_failed', payment_info: { role: 'rider' } }, 'Coach X')
  assert.match(f, /Coach X/)
})

test('payments nav item after messages, only when requested', () => {
  const base = [{ key: 'a' }, { key: 'messages' }, { key: 'b' }]
  assert.deepEqual(withPaymentsItem(base).map((i) => i.key), ['a', 'messages', 'payments', 'b'])
  assert.ok(!sidebarItems(NAV_ITEMS, null, false, false, true, [], false).some((i) => i.key === 'payments'))
  assert.ok(sidebarItems(NAV_ITEMS, null, false, false, true, [], true).some((i) => i.key === 'payments'))
})
