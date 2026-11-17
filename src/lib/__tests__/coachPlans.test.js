import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { usageLabel, planNote, atLimit, isPlanLimitError, tierLimitLabel, tierPriceLabel, FEE_BREAKDOWN } from '../coachPlans.js'

const free = { tier_name: 'Free', limit: 3, active: 2, enforced: false, founding: false, can_accept: true }

test('usage label and notes', () => {
  assert.equal(usageLabel(free), '2 of 3 athletes on Free')
  assert.equal(usageLabel({ ...free, limit: null, active: 1, tier_name: 'Roster Unlimited' }), '1 athlete on Roster Unlimited')
  assert.match(usageLabel({ ...free, founding: true }), /Founding coach/)
  assert.match(planNote(free), /early access/i)
  assert.ok(atLimit({ ...free, active: 3 }))
  assert.match(planNote({ ...free, active: 4 }), /nothing is blocked/)
  assert.match(planNote({ ...free, enforced: true, can_accept: false }), /Existing athletes, chat and exports/)
  assert.equal(planNote({ ...free, enforced: true }), '')
})

test('tier labels, error detection and fee text', () => {
  assert.equal(tierLimitLabel({ max_athletes: null }), 'Unlimited athletes')
  assert.equal(tierPriceLabel({ price_cents: 0 }), 'Free')
  assert.equal(tierPriceLabel({ price_cents: null }), 'Price to be announced')
  assert.ok(isPlanLimitError({ message: 'Coach plan athlete limit reached' }))
  assert.ok(!isPlanLimitError({ message: 'other' }))
  assert.ok(FEE_BREAKDOWN.some((x) => /STRIPE_APPLICATION_FEE_PERCENT/.test(x)))
  assert.ok(FEE_BREAKDOWN.some((x) => /merchant of record/.test(x)) && FEE_BREAKDOWN.some((x) => /disputes/.test(x)))
})

test('wiring: nav link, badges, meter and explainer exist', () => {
  const r = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  assert.match(r('components/AdminNav.js'), /\/admin\/coach-plans/)
  assert.match(r('app/coaches/page.js'), /FoundingBadge/)
  assert.match(r('app/c/[slug]/page.js'), /FoundingBadge/)
  assert.match(r('app/coach/page.js'), /CoachPlanMeter/)
  assert.match(r('components/CoachBillingPanel.js'), /payments-explainer/)
})
