# Admin dashboard (`/admin`)

Admin-only overview (gate: `profiles.is_admin`, same as the other `/admin/*` pages). All data comes from one RPC,
`admin_dashboard_stats(p_days)` (`20270128000000_admin_dashboard.sql`), a SECURITY DEFINER function that raises `Admin only`
for non-admins. It returns **aggregates and anonymous lists only**: no user ids, names or e-mails; no RLS or table
privileges were changed. Bots (`profiles.is_bot`, `activities.source = 'bot'`) are excluded from user and ride figures.
`p_days` (7-90, default 30) sets the length of the daily charts.

Panels
- **Suggestions**: pending count and per type, approved/rejected in 30 days, oldest pending, the 10 newest pending (link to the
  existing review page, `/admin/suggestions/[id]`), unmatched gym exercises and open comment reports.
- **Users**: total, new today/7d/30d, daily signup chart, active 7d/30d (signed in via `auth.users.last_sign_in_at` or uploaded a
  ride), inactive 30d+ (including never seen), never uploaded, coaching relationships (active/pending).
- **Rides**: new uploads today/7d/30d, per-day chart, split by `activities.source` (Upload = `manual`, Garmin, Wahoo, Intervals, Strava)
  and `activity_type` (ride/run/gym) in the selected window.
- **Templates**: user templates private vs public, system templates, created 7d/30d, stored runs (`template_executions`) total/7d/30d,
  per-day charts, and failed re-run job items (`template_rerun_items`).
- **Synchronisation**: per provider connected / error / stale (active but not synced for 3+ days) connections, rides imported 24h/7d,
  last sync, grouped recent connection errors (long ids stripped), and Garmin webhook events (`garmin_activity_events`).
  Wahoo and Intervals webhooks keep no event log, so their activity is shown through imported rides.

Pure helpers (trend, percentages, provider health/order) live in `src/lib/adminDashboard.js` with tests.
DB test: `scripts/db-harness/admin-dashboard-adversarial.mjs` (see its README).

## Third-party app stats

The dashboard's "Third-party apps" panel is fed by `admin_partner_stats(p_days)` (`20270134000000_admin_partner_stats.sql`), a separate admin-only SECURITY DEFINER function (raises `Admin only`). It returns app counts by status, connected riders, a per-app table (riders, uploads 24h/7d/30d/all, imported/duplicate/failed, failure rate, activities, 429s, refreshes, refresh-reuse revocations, last upload), a daily upload series and recent failure texts. Aggregates only; no rider identities. Rows link to `/admin/partner-apps`.

## Respect stats

The "Respect" panel is fed by `admin_respect_stats(p_days)` (`20270140000000_admin_respect_stats.sql`), another admin-only SECURITY DEFINER function (raises `Admin only`) that follows the 7/30/90-day period buttons. It returns total respects (period and all time), distinct reactors, receivers and reacted-to activities, average per reacted activity, a daily series, the share of active users (signed in or uploaded in the window) who gave / received a Respect, splits by activity type and public vs non-public, reaction notifications sent (and respects they cover), and how many users turned reactions or reaction notifications off. Bots are excluded; aggregates only, no rider identities. Rate-limit hits are not shown because they are not recorded.

### Respect tiers

The Respect panel also lists each tier (names/thresholds from `RESPECT_LEVELS` in `src/lib/respectLevel.js`, the single source of truth) with how many activities currently sit in it (highest tier reached) and how many reached at least that tier. Data comes from `admin_respect_histogram()` (`20270141000000_admin_respect_histogram.sql`, admin-only SECURITY DEFINER): an all-time histogram "N Respects → number of activities", bucketed in JS by `respectTiers()`. Same rules as above: aggregates only, bots excluded.
