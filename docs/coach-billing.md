# Coach payments (Stripe Connect, test mode)

Part of the coach module; dark behind the `coach_module` flag (enforced in the RPCs and in `billing_checkout_context`). **Test mode only**: the integration disables itself unless `STRIPE_SECRET_KEY` is a `sk_test_`/`rk_test_` key. Going live is a deliberate later change (see "Going live").

## Configuration (server environment only, never in the repo or database)
- `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (signing secret of the webhook endpoint), optional `STRIPE_APPLICATION_FEE_PERCENT` (0-50, default 0: the platform takes no fee at launch, the coach bears Stripe's fees).
- Stripe webhook endpoint: `POST /api/webhooks/stripe`, with Connect events enabled. Events: `account.updated`, `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created|updated|deleted`, `charge.refunded`.
- Without these variables everything degrades gracefully: routes answer 503 and the UI shows "Payments are not available yet".

## Flow
1. Coach (`/settings/coach-card` > Payments) starts Express onboarding: `POST /api/billing/connect/onboard` creates the account once (idempotent) and returns a hosted onboarding link. `account.updated` keeps `charges_enabled`/`payouts_enabled` current.
2. (Free period: a subscription package can have 0-90 free days, `coach_packages.trial_days`, set in the package editor. Checkout passes it as Stripe `subscription_data.trial_period_days`, so the card is collected up front and the first charge happens after the trial; the subscription shows as `trialing`. It does not apply to one-time packages.) Athlete applies, the coach accepts. The application records the chosen package; there are no pay buttons on the public card. Once the coach accepts, the athlete gets a `payment_requested` notification and a "Pay for your plan" block in Settings -> Coaching (`my_payment_due()`), which calls `POST /api/billing/checkout`: a Checkout Session as a **destination charge** to the coach's account (subscription or one-time; price data is inline, so no Stripe products are stored).
3. Webhooks update `coach_subscriptions` and `payments_ledger`; the coach gets `subscription_started`, `subscription_ended`, `payment_failed` notifications (no amounts or card data). The rider manages or cancels through the Stripe customer portal (`POST /api/billing/portal`).

## Rules enforced in `billing_checkout_context`
Package active and not free; not your own package; flag enabled for both sides; no block between them; coach card public; coach `charges_enabled`; an **active** relationship exists (no pre-acceptance payments); athletes under 18 (by their onboarding date of birth) are refused until a guardian policy exists (open decision).

## Security
- Webhook: raw body HMAC-SHA256 signature check with 5-minute tolerance; idempotent through `stripe_events` (a failed event is forgotten so Stripe's retry reprocesses it); returns 500 on failure so Stripe retries. Only event type and id are logged.
- Metadata ids are validated as UUIDs; a subscription's coach/rider come from its first record and cannot be moved by later events.
- Billing tables have no client privileges; every write goes through service-role-only `billing_*` functions.
- Access to coaching is never gated by payment. Ending a relationship does not cancel the subscription: the coach and athlete handle that (portal/dashboard).

## Decisions and limitations (for review)
- Dispute events (`charge.dispute.created`) are not handled automatically (the dispute object has no reliable link to the coach); disputes are handled in the Stripe dashboard. Refunds are recorded in the ledger.
- Stripe Tax / VAT is not configured by us; each coach is the merchant of record and sets their own tax settings in Stripe.
- No refund/dispute policy text on the card yet (coach terms live in the package description).
- Going live requires: live keys in the host environment, a live webhook endpoint, relaxing the `sk_test_` guard on purpose, and a review of the minors policy and terms.

## Setup steps and fee breakdown (coach-facing explainer)
Shown in-app on the coach card Payments panel ("How payments and fees work").
1. Set up payments: Stripe Express onboarding (identity, business details, payout bank account).
2. Status turns ready when Stripe enables charges and payouts.
3. Add paid packages; athletes pay only after the coach accepted them.

Who pays which fee: the athlete pays the package price; Stripe's processing fee is paid by the coach (deducted from the payout);
the platform fee is 0 % (`STRIPE_APPLICATION_FEE_PERCENT`, unchanged); Stripe pays out the rest to the coach.
Platform subscription billing for coach plans (`docs/coach-plans.md`) is out of scope and not charged.
