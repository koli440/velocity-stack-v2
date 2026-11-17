// Coach plans (docs/coach-plans.md): model and limits only. Nothing is charged; limits are soft until an admin
// turns coach_plans_enforced on, and then only NEW acceptances above the limit are blocked.
export const FOUNDING_LABEL = 'Founding coach'

export async function fetchMyCoachPlan(client) {
  const { data, error } = await client.rpc('my_coach_plan')
  return { plan: error ? null : data, error }
}

/** "2 of 3 athletes on Free" (unlimited: "2 athletes on Roster Unlimited"). */
export function usageLabel(plan) {
  if (!plan) return ''
  const n = Number(plan.active) || 0
  const name = plan.founding ? `${plan.tier_name} (${FOUNDING_LABEL})` : plan.tier_name
  return plan.limit == null ? `${n} ${n === 1 ? 'athlete' : 'athletes'} on ${name}` : `${n} of ${plan.limit} athletes on ${name}`
}

export const atLimit = (plan) => !!plan && plan.limit != null && plan.active >= plan.limit

/** Status line below the meter. */
export function planNote(plan) {
  if (!plan) return ''
  if (!plan.enforced) return atLimit(plan)
    ? 'Free during early access: you are over the Free limit but nothing is blocked or charged.'
    : 'Free during early access. Limits are not enforced and nothing is charged.'
  return plan.can_accept ? '' : 'You reached your plan limit: new athletes cannot be accepted until you move to a larger plan. Existing athletes, chat and exports are not affected.'
}

export const tierLimitLabel = (t) => (t.max_athletes == null ? 'Unlimited athletes' : `Up to ${t.max_athletes} athletes`)
export const tierPriceLabel = (t) => (t.price_cents === 0 ? 'Free' : 'Price to be announced')

/** Plans error from accept_coaching shown to the coach. */
export const isPlanLimitError = (e) => /plan athlete limit/i.test(String(e?.message || e || ''))

export const FEE_BREAKDOWN = Object.freeze([
  'You are the merchant of record: the athlete pays you directly and the money goes straight to your Stripe account. The platform never holds it.',
  "Stripe's processing fee is charged to your Stripe account by Stripe; you pay it. The athlete pays no extra fee.",
  'The platform fee is 0 % at launch (STRIPE_APPLICATION_FEE_PERCENT). If it is ever raised it is announced first and is taken from each payment on your side.',
  'Tax/VAT, invoices, refunds and disputes are your responsibility, handled in your own Stripe Express dashboard.',
])

export const STRIPE_SETUP_STEPS = Object.freeze([
  'Press "Set up payments" below: you are sent to Stripe to create your Express account.',
  'Confirm your identity and business details and add the bank account for payouts.',
  'Come back here: the status turns to ready once Stripe enables charges and payouts.',
  'Add paid packages to your coach card. Athletes pay only after you accepted them.',
  'Manage payouts, tax settings, refunds and disputes in your Stripe Express dashboard.',
])
