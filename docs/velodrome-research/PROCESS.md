# Velodrome info pipeline: researcher, reviewer, apply, refresh

Goal: confirmed venue info for every velodrome (website, booking, operator, year built, organisational phone/email, opening hours, pricing link + rough price range, open/closed status) without publishing unverified claims. No human reviews each value; an **independent reviewer session** replaces that, and strict auto-apply rules limit what may reach the public `tracks` table. Schema: `supabase/migrations/20270135000000_velodrome_track_info.sql`.

## Data model (summary)
- Public columns on `tracks` (public-read, so **everything is public**): `website_url`, `pricing_url`, `booking_url` (existing), `operator`, `year_built`, `phone`, `email`, `contact_is_organisational`, `opening_hours` (free text) + `opening_hours_spec` (schema.org form, JSON-LD only), `price_min`/`price_max`/`price_currency`, `operating_status` (`open|closed|unknown`) + `operating_status_checked_at`, `info_verified_at` (derived).
- "Check their site" is not stored: it is always true, so the page always shows the note next to a price.
- `track_info_sources`: one row per check of a (track, field). `is_current` marks the latest; older rows are history. `status`: `verified`, `not_found` (checked, nothing official found), `stale` (page changed/unreachable at re-check, not "wrong"), `needs_attention`. Also `source_url` (http/https only), `source_kind`, `evidence_quote`, `confidence`, `content_hash`, `verified_at`. Public may read only current `verified` rows; writes are service-role only via `upsert_track_info_source()` (idempotent).
- `track_info_refresh_due` (service role): never-checked, stale and >90-day-old checks.

## Contacts: deliberate privacy decision
`tracks` is world-readable. Only **organisational** contacts (generic venue phone line or mailbox such as info@venue) may be stored. Never personal or named-staff numbers/addresses, never council or town-hall general lines. The DB enforces `phone/email` ⇒ `contact_is_organisational = TRUE`; the flag is a researcher assertion the reviewer must re-check. phone/email/the flag are not rider-suggestible, and the site never loads or shows `email`. If a venue publishes only staff or council contacts, record `not_found`.

## Roles
1. **Researcher**: finds sources and quotes (see README method). Official sources only: venue/operator domain, owner municipality, national or continental federation, UCI. No Wikipedia, directories, aggregators or web-search summaries. Output follows `pilot.json` (value, `source_url`, verbatim `evidence`, `confidence`, `source_kind`), plus `not_found` fields and proposed corrections.
2. **Reviewer** (separate session, no access to the researcher's reasoning): re-fetches every URL, checks the quote appears and supports the value, prefers the operator's own site over municipal listings, looks for conflicting official sources, and emits per-value verdicts (`verified | rejected | unverifiable`, with `source_url_fix` if the value is right but the cited page is wrong) as in `pilot-review.json`.
3. **Applier** (script run with the service role, no secrets in the repo): applies only what the rules below allow, via `upsert_track_info_source()` + a `tracks` update, and writes the needs-attention report.

## Auto-apply rules
A value is applied to `tracks` automatically only if **all** hold:
- confidence `high`;
- the reviewer verdict is `verified` **and** a second, independent fetch of the cited URL re-confirms the verbatim quote;
- the source is the operator, owner or federation domain (`source_kind` in `operator|owner|federation`);
- the value is non-personal (generic venue phone/mailbox, URL, year, price range with currency, status);
- the field is currently null (fill-only), or the new value equals the existing one (re-confirmation).

Never auto-applied; they go to the **needs-attention report** (`status = needs_attention`, nothing written to `tracks`):
- corrections or renames of existing values (including surface/length/coordinates);
- staff, personal or council/town general contacts;
- `medium`/`low` confidence;
- fields where two official sources disagree (flag the conflict, never pick one);
- prices from club or event pages, group/hall rental, or hours not specific to the track;
- `operating_status = closed` inferred from news rather than the operator/owner (report it; apply only when an official source states it).
Rejected and unverifiable values never reach `tracks`; they stay in the audit table only. Fields with no official source are recorded `not_found` (so refreshes can tell "never checked" from "checked, none").

## Batch quality gate
After each batch, randomly sample ~10% of auto-applied rows (at least 3) for a fresh independent check of URL, quote and value. **Halt the rollout if more than 5% of the sampled rows fail**; fix the rules/prompts and re-review the whole batch (revert failed values by re-running the upsert with the corrected state). Record sample size and failures in the batch log.

## Quarterly refresh
Runs every quarter (and can be run ad hoc), driven by `track_info_refresh_due`:
1. For each due (track, field) re-fetch the current `source_url` and compare `content_hash`/quote.
2. Quote still present, hash unchanged: call `upsert_track_info_source()` with identical data; this only bumps `verified_at` (idempotent, no new rows).
3. Page changed but quote and value still hold: new `content_hash`, bump `verified_at`.
4. Quote gone, page changed materially, or non-200: mark `stale` (value stays public until re-researched; stale is not wrong) and queue the field for a full researcher + reviewer pass.
5. `not_found` fields are re-searched; a found value follows the normal rules.
6. Always re-check `operating_status` and set `operating_status_checked_at`; closures are a needs-attention item.
`info_verified_at` is derived by trigger from current verified rows, and shown on the page. Everything is plain SQL + a script run with the service role; no secrets are stored in GitHub or the repo.

## Display
`/velodromes/[slug]` shows operator, year built, hours, price range with a "check their site" note, website/pricing/booking links, last-verified date and, for closed tracks, a banner (booking, hours and prices are hidden). JSON-LD gains `telephone` (organisational only), `openingHours` (from `opening_hours_spec`), `priceRange` (only when known and open). Pages without data render as before.
