# Coach plans and founding coaches

Dark by default: nothing is charged and nothing is blocked until an admin turns `coach_plans_enforced` on
(`coach_plan_settings.enforced`, default off). Platform subscription billing for plans is out of scope; this is the model and limits only.

## Model (migration 20270182000000)
- `coach_plan_tiers`: admin-editable (`/admin/coach-plans`). Seeded: `free` (3 athletes), `roster_10`, `roster_25`, `roster_unlimited`.
  `max_athletes` NULL = unlimited; `price_cents` is a placeholder, never charged. Free must stay active and limited.
- Only **active** coaching relationships count. Bot coaches are exempt.
- `coach_founders`: admin-granted, capped by `founding_cap` (default 20, editable). The tier limit and price are snapshotted
  at grant time, so later tier edits never downgrade a founder. Revoking returns the coach to Free.
- RPCs: `my_coach_plan()` (coach), `admin_coach_plans_status`, `admin_set_coach_plans`, `admin_set_coach_plan_tier`,
  `admin_grant_founder`, `admin_revoke_founder` (admin only). `coach_card_json` and `list_coaches` expose a `founding` boolean.

## Behaviour
- Enforcement off: the coach sees a usage meter ("2 of 3 athletes on Free") on `/coach` and a Plans page (`/coach/plans`), "free during early access".
- Enforcement on: `coaching_accept_as` refuses only NEW acceptances above the limit ("Coach plan athlete limit reached").
  Existing athletes, chat and data export are never locked.
- "Founding coach" badge on the public card and in the directory.

## Decisions
Bots exempt; founder tier snapshot; default Free limit 3 lives in the table, not in code.
See also `docs/coach-billing.md` for the payment flow and fee breakdown.
