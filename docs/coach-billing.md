# Coach payments (Stripe Connect, direct charges, test mode)

**The platform does not collect money.** Coaches are the merchant of record and payments go straight to the coach's connected Express account: Checkout Sessions, customers, subscriptions, billing-portal sessions and refunds are all created/handled **on the connected account** (`Stripe-Account` header, `stripeFetch(..., { stripeAccount })`). There are no destination charges or transfers.

Part of the coach module; dark behind the `coach_module` flag (enforced in the RPCs and in `billing_checkout_context`). **Test mode only**: the integration disables itself unless `STRIPE_SECRET_KEY` is a `sk_test_`/`rk_test_` key. Going live is a deliberate later change (see "Going live").

## Configuration (server environment only, never in the repo or database)
- `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (signing secret of the webhook endpoint), optional `STRIPE_CONNECT_WEBHOOK_SECRET` (signing secret of a separate Connect endpoint, if you use one), optional `STRIPE_APPLICATION_FEE_PERCENT` (0-50, default 0: no platform fee at launch). If set it becomes `application_fee_percent` (subscriptions) / `application_fee_amount` (one-time) on the direct charge.
- Stripe webhook endpoint: `POST /api/webhooks/stripe`, with "Listen to events on Connected accounts" enabled. Connect events carry `account`: the webhook verifies the signature, maps the event to the coach through that account id (`billing_apply_*` take `p_account`; the coach is never taken from metadata), and stays idempotent through `stripe_events`. Events without a known account are ignored. Events: `account.updated`, `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created|updated|deleted`, `charge.refunded`.
- Without these variables everything degrades gracefully: routes answer 503 and the UI shows "Payments are not available yet".

## Flow
1. Coach (`/settings/coach-card` > Payments) starts onboarding: `POST /api/billing/connect/onboard` creates the account once (idempotent) through **Accounts v2** (`POST /v2/core/accounts`; Stripe rejects the legacy v1 `type: 'express'` when the platform is the losses collector) and returns a hosted v2 account link. The account has no `type`, `defaults.responsibilities.fees_collector = stripe` and `losses_collector = stripe` (Managed Risk: Stripe, not the platform, bears negative balances), `configuration.merchant.capabilities.card_payments.requested`, and `dashboard = express` (public preview, sent with the `2026-10-28.preview` version; if the platform cannot use it the call falls back to `dashboard = full` on the GA version). Accounts created earlier with v1 still work (v1 account-link fallback).
   **Status sync:** v2 account changes are *thin* events (`v2.core.account[...]`) that a snapshot destination does not receive, so `GET /api/billing/connect/status` re-reads the account from Stripe (`GET /v2/core/accounts/{id}`) while it is not yet ready and stores the flags (charges = `card_payments` active, payouts = `stripe_balance.payouts` active). If a thin destination for v2 account events is added, the webhook handles those too by fetching the account. Direct-charge events (checkout, subscriptions, invoices, refunds) stay ordinary snapshot events with `account` set, so the existing destination keeps working.
2. (Free period: a subscription package can have 0-90 free days, `coach_packages.trial_days`, set in the package editor. Checkout passes it as Stripe `subscription_data.trial_period_days`, so the card is collected up front and the first charge happens after the trial; the subscription shows as `trialing`. It does not apply to one-time packages.) Athlete applies, the coach accepts. The application records the chosen package; there are no pay buttons on the public card. Once the coach accepts, the athlete gets a `payment_requested` notification and a "Pay for your plan" block in Settings -> Coaching (`my_payment_due()`), which calls `POST /api/billing/checkout`: a Checkout Session created **on the coach's connected account** (direct charge; subscription or one-time; price data is inline, so no Stripe products are stored). The rider's Stripe customer is created once per (coach account, rider) on that account and stored in `coach_rider_customers`; Checkout reuses it.
3. Webhooks update `coach_subscriptions` and `payments_ledger`; the coach gets `subscription_started`, `subscription_ended`, `payment_failed` notifications (no amounts or card data). The rider manages or cancels through the Stripe customer portal (`POST /api/billing/portal`, optional `{ coachId }`), opened on the coach's account (the coach's portal settings in Stripe apply).

## Rules enforced in `billing_checkout_context`
Package active and not free; not your own package; flag enabled for both sides; no block between them; coach card public; coach `charges_enabled`; an **active** relationship exists (no pre-acceptance payments); athletes under 18 (by their onboarding date of birth) are refused until a guardian policy exists (open decision).

## Security
- Webhook: raw body HMAC-SHA256 signature check with 5-minute tolerance; idempotent through `stripe_events` (a failed event is forgotten so Stripe's retry reprocesses it); returns 500 on failure so Stripe retries. Only event type and id are logged.
- Metadata ids are validated as UUIDs; a subscription's coach/rider come from its first record and cannot be moved by later events.
- Billing tables have no client privileges; every write goes through service-role-only `billing_*` functions.
- Access to coaching is never gated by payment. Ending a relationship does not cancel the subscription: the coach and athlete handle that (portal/dashboard).

## Decisions and limitations (for review)
- Dispute events (`charge.dispute.created`) are not handled automatically (the dispute object has no reliable link to the coach); disputes are handled in the Stripe dashboard. Refunds are recorded in the ledger.
- Stripe Tax / VAT, invoices and disputes are the coach's responsibility, handled in their own Stripe Express dashboard (we do not configure tax or handle disputes).
- Subscriptions created before the switch (test mode only) were destination charges on the platform account; they are not migrated and the portal may not open for them.
- No refund/dispute policy text on the card yet (coach terms live in the package description).
- Going live requires: live keys in the host environment, a live webhook endpoint, relaxing the `sk_test_` guard on purpose, and a review of the minors policy and terms.

## Setup steps and fee breakdown (coach-facing explainer)
Shown in-app on the coach card Payments panel ("How payments and fees work").
1. Set up payments: Stripe Express onboarding (identity, business details, payout bank account).
2. Status turns ready when Stripe enables charges and payouts.
3. Add paid packages; athletes pay only after the coach accepted them.

Who pays which fee: the athlete pays the package price to the coach (merchant of record); Stripe's processing fee is charged to the coach's Stripe account
(the athlete pays no extra fee); the platform fee is 0 % (`STRIPE_APPLICATION_FEE_PERCENT`; if ever raised it is an `application_fee_*` on each payment, on the coach's side);
Stripe pays out to the coach's bank account. Tax/VAT, refunds and disputes are handled by the coach in their Stripe Express dashboard.
Platform subscription billing for coach plans (`docs/coach-plans.md`) is out of scope and not charged.

**Country (required):** Stripe requires `identity.country` before `configuration.merchant` can be set, so the Payments panel shows a required country select (EU/EEA + UK/CH, preselected from the browser locale) and `POST /api/billing/connect/onboard` returns `400 "Choose your country"` when a new account would be created without one. Create payload: `dashboard`, `identity.country`, `contact_email`, `defaults.responsibilities.{fees,losses}_collector = stripe`, `configuration.merchant.capabilities.card_payments.requested`, `metadata.coach_id`; account link: `use_case.account_onboarding.{configurations:['merchant'],refresh_url,return_url}`.
