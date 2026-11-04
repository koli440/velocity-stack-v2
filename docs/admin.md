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
